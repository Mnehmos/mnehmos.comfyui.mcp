/**
 * Render orchestration: gate -> seed -> queue -> record -> (wait) -> outputs.
 * Every branch returns a structured result; the DB is the durable record.
 */
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import type { ComfyClient, HistoryEntry } from './comfyClient.js';
import { ComfyUnreachableError } from './comfyClient.js';
import { validateWorkflow } from './gates.js';
import { generateMasterSeed, injectSeeds } from './seedService.js';
import { readWorkflow, workflowHash } from './workflows.js';
import type { Provenance, ToolError } from '../schema/contracts.js';
import { toolError } from '../schema/contracts.js';
import type { RunsDb } from '../storage/db.js';
import type { Env } from '../schema/env.js';

export interface RenderDeps {
  env: Env;
  client: ComfyClient;
  db: RunsDb;
}

type Result<T> = { ok: true; data: T } | (ToolError & { gate?: unknown });

export async function renderSubmit(
  args: {
    workflow?: Record<string, unknown>;
    workflow_name?: string;
    master_seed?: number;
    dry_run: boolean;
    wait: boolean;
    timeout_seconds: number;
  },
  deps: RenderDeps,
): Promise<Result<Record<string, unknown>>> {
  // 1. Resolve workflow (inline wins; else named library file).
  let wf: Record<string, unknown> | undefined = args.workflow;
  let wfName: string | null = null;
  if (!wf) {
    if (!args.workflow_name) {
      return toolError('workflow_required', 'Provide either workflow (inline JSON) or workflow_name (file in the workflows library).', {
        field: 'workflow',
        retry_allowed: true,
      });
    }
    try {
      wf = readWorkflow(deps.env.COMFYUI_WORKFLOWS_DIR, args.workflow_name);
      wfName = path.basename(args.workflow_name);
    } catch (err) {
      return toolError('workflow_not_found', (err as Error).message, { field: 'workflow_name', retry_allowed: true });
    }
  }

  // 2. Basics gate against the live server.
  let objectInfo;
  try {
    objectInfo = await deps.client.objectInfo();
  } catch (err) {
    return toolError(
      'comfyui_unreachable',
      err instanceof ComfyUnreachableError ? err.detail : String(err),
      { retry_allowed: true },
    );
  }
  const verdict = validateWorkflow(wf, {
    objectInfo,
    modelsDir: deps.env.COMFYUI_MODELS_DIR,
    inputDir: deps.env.COMFYUI_INPUT_DIR,
  });
  if (!verdict.ok) {
    return {
      ...toolError('validation_failed', `Basics gate rejected the workflow: ${verdict.errors.length} error(s), first: ${verdict.errors[0]?.detail ?? 'unknown'}`, {
        retry_allowed: true,
      }),
      gate: verdict,
    };
  }

  // 3. Seed ownership.
  const masterSeed = args.master_seed ?? generateMasterSeed();
  const seeds = injectSeeds(wf, masterSeed);
  const hash = workflowHash(wf);

  if (args.dry_run) {
    return {
      ok: true,
      data: {
        dry_run: true,
        would_queue: true,
        gate: verdict,
        master_seed: masterSeed,
        seeds,
        workflow_hash: hash,
        workflow_name: wfName,
      },
    };
  }

  // 4. Queue.
  let version = 'unknown';
  try {
    const stats = await deps.client.systemStats();
    version = stats.system.comfyui_version;
  } catch {
    /* object_info already succeeded; version is best-effort */
  }
  let promptId: string;
  try {
    const res = await deps.client.prompt(wf, 'mnehmos-comfyui-mcp');
    promptId = res.prompt_id;
  } catch (err) {
    return toolError('queue_failed', err instanceof ComfyUnreachableError ? err.detail : String(err), {
      retry_allowed: true,
    });
  }

  const runId = randomUUID();
  const now = new Date().toISOString();
  deps.db.insertRun({
    run_id: runId,
    prompt_id: promptId,
    workflow_name: wfName,
    workflow_hash: hash,
    master_seed: masterSeed,
    seeds_json: JSON.stringify(seeds),
    status: 'queued',
    error: null,
    comfy_version: version,
    submitted_at: now,
  });

  // 5. Optionally wait for completion.
  if (args.wait) {
    const final = await waitForRun(promptId, args.timeout_seconds, deps);
    if (final.ok) {
      const outputs = extractOutputs(final.data);
      deps.db.updateRunStatus(runId, 'success', {
        finished_at: new Date().toISOString(),
        outputs_json: JSON.stringify(outputs),
      });
      return { ok: true, data: buildProvenance(deps, runId, promptId, wfName, hash, masterSeed, seeds, version, now, outputs) };
    }
    deps.db.updateRunStatus(runId, 'failed', {
      finished_at: new Date().toISOString(),
      error: final.detail,
    });
    return final;
  }

  return {
    ok: true,
    data: {
      run_id: runId,
      prompt_id: promptId,
      status: 'queued',
      master_seed: masterSeed,
      seeds,
      note: 'wait=false: poll with comfy_render action=status run_id=' + runId,
    },
  };
}

async function waitForRun(
  promptId: string,
  timeoutSeconds: number,
  deps: RenderDeps,
): Promise<Result<HistoryEntry>> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    let hist: Record<string, HistoryEntry>;
    try {
      hist = await deps.client.history(promptId);
    } catch {
      await sleep(1500);
      continue;
    }
    const entry = hist[promptId];
    if (entry && entry.status?.completed) return { ok: true, data: entry };
    await sleep(1500);
  }
  return toolError('render_timeout', `Run ${promptId} did not finish within ${timeoutSeconds}s. It may still be rendering — poll comfy_render action=status.`, {
    retry_allowed: true,
  });
}

function extractOutputs(entry: HistoryEntry): Provenance['outputs'] {
  const out: Provenance['outputs'] = [];
  for (const nodeOut of Object.values(entry.outputs ?? {})) {
    const images = (nodeOut as Record<string, unknown>).images as Array<Record<string, string>> | undefined;
    if (Array.isArray(images)) {
      for (const im of images) {
        out.push({
          filename: im.filename,
          subfolder: im.subfolder ?? '',
          type: im.type ?? 'output',
        });
      }
    }
  }
  return out;
}

function buildProvenance(
  deps: RenderDeps,
  runId: string,
  promptId: string,
  wfName: string | null,
  hash: string,
  masterSeed: number,
  seeds: Array<{ node_id: string; input_name: string; seed: number }>,
  version: string,
  submittedAt: string,
  outputs: Provenance['outputs'],
): Provenance {
  return {
    run_id: runId,
    prompt_id: promptId,
    workflow_name: wfName,
    workflow_hash: hash,
    master_seed: masterSeed,
    seeds,
    comfy_version: version,
    submitted_at: submittedAt,
    finished_at: new Date().toISOString(),
    outputs: outputs.map((o) => ({
      ...o,
      absolute_path: o.type === 'output'
        ? path.join(deps.env.COMFYUI_OUTPUT_DIR, o.subfolder, o.filename)
        : undefined,
    })),
  };
}

export async function renderStatus(runId: string | undefined, deps: RenderDeps): Promise<Result<Record<string, unknown>>> {
  if (!runId) {
    return toolError('run_id_required', 'Provide run_id from a prior comfy_render submit.', {
      field: 'run_id',
      retry_allowed: true,
    });
  }
  const row = deps.db.getRun(runId);
  if (!row) {
    return toolError('run_not_found', `No run with id ${runId}. Recent runs: ${JSON.stringify(deps.db.recentRuns(5).map((r) => ({ run_id: r.run_id, status: r.status })))}`, {
      retry_allowed: true,
    });
  }
  let live: Record<string, unknown> | undefined;
  try {
    const hist = await deps.client.history(row.prompt_id);
    const entry = hist[row.prompt_id];
    if (entry) {
      live = {
        completed: entry.status?.completed,
        status_str: entry.status?.status_str,
        outputs: extractOutputs(entry),
      };
    } else {
      const q = await deps.client.queue();
      const pending = q.queue_pending.length;
      const running = q.queue_running.length;
      live = { in_queue: pending + running > 0, queue_pending: pending, queue_running: running };
    }
  } catch {
    live = { note: 'ComfyUI unreachable; DB state shown' };
  }
  return {
    ok: true,
    data: {
      run_id: row.run_id,
      prompt_id: row.prompt_id,
      workflow_name: row.workflow_name,
      status: row.status,
      master_seed: row.master_seed,
      submitted_at: row.submitted_at,
      finished_at: row.finished_at,
      error: row.error,
      live,
    },
  };
}

export async function renderOutputs(runId: string | undefined, deps: RenderDeps): Promise<Result<Record<string, unknown>>> {
  if (!runId) {
    return toolError('run_id_required', 'Provide run_id from a prior comfy_render submit.', { field: 'run_id', retry_allowed: true });
  }
  const row = deps.db.getRun(runId);
  if (!row) return toolError('run_not_found', `No run with id ${runId}.`, { retry_allowed: true });
  let outputs: Array<Record<string, unknown>> = [];
  try {
    outputs = JSON.parse(row.outputs_json);
  } catch {
    outputs = [];
  }
  if (outputs.length === 0) {
    // Maybe finished since last sync — check live history.
    try {
      const hist = await deps.client.history(row.prompt_id);
      const entry = hist[row.prompt_id];
      if (entry?.status?.completed) {
        outputs = extractOutputs(entry);
        deps.db.updateRunStatus(runId, 'success', {
          finished_at: new Date().toISOString(),
          outputs_json: JSON.stringify(outputs),
        });
      }
    } catch {
      /* unreachable — return DB state */
    }
  }
  return {
    ok: true,
    data: {
      run_id: runId,
      status: outputs.length ? 'success' : row.status,
      outputs: outputs.map((o) => ({
        ...o,
        absolute_path: path.join(deps.env.COMFYUI_OUTPUT_DIR, String(o.subfolder ?? ''), String(o.filename)),
      })),
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
