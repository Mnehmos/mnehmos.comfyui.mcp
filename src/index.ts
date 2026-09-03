#!/usr/bin/env node
/**
 * mnehmos.comfyui.mcp — MCP server for the local ComfyUI render service.
 *
 * Doctrine mapping (vibe-coders-bible):
 *  - ch.9  consolidated action-enum tools, dry-run, structured failures
 *  - ch.25 the model narrates, the engine rules: server validates + owns seeds
 *  - ch.28 state first, pixels second: basics gate before any queued compute,
 *          provenance manifest for every render
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { loadEnv } from './schema/env.js';
import {
  ComfyServerArgsSchema,
  ComfyWorkflowsArgsSchema,
  ComfyRenderArgsSchema,
  ComfyModelsArgsSchema,
} from './schema/tools.js';
import { createComfyClient, ComfyUnreachableError } from './engine/comfyClient.js';
import { listWorkflows, readWorkflow } from './engine/workflows.js';
import { validateWorkflow } from './engine/gates.js';
import { listModels } from './engine/models.js';
import { renderSubmit, renderStatus, renderOutputs } from './engine/render.js';
import { RunsDb } from './storage/db.js';

const env = loadEnv();
const client = createComfyClient(env.COMFYUI_URL);
const db = new RunsDb(env.COMFYUI_MCP_DB);

const TOOLS: Tool[] = [
  {
    name: 'comfy_server',
    description:
      'ComfyUI service status and control. Actions: status (version, VRAM, queue depth), queue (running/pending entries), interrupt (cancel the current render).',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['status', 'queue', 'interrupt'], description: 'What to do' } },
      required: ['action'],
    },
  },
  {
    name: 'comfy_workflows',
    description:
      'Workflow library. Actions: list (files in the canonical workflows dir with format detection), get (fetch one workflow JSON by name), validate (basics gate: node types exist on the server, required inputs present, model files on disk).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'validate'] },
        name: { type: 'string', description: 'Workflow file name in the library' },
        content: { type: 'object', description: 'Inline workflow JSON to validate (instead of name)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'comfy_render',
    description:
      'Queue and track renders. Actions: submit (validate -> seed -> queue a workflow; dry_run=true for plan only; wait=false to poll later), status (run state from DB + live server), outputs (result files with absolute paths). Seeds are owned by the server and recorded with full provenance; pass master_seed only to replay a prior run.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['submit', 'status', 'outputs'] },
        workflow: { type: 'object', description: 'Inline API-format workflow JSON' },
        workflow_name: { type: 'string', description: 'Workflow file name in the library' },
        master_seed: { type: 'integer', minimum: 0, description: 'Replay seed (omit for server-generated)' },
        dry_run: { type: 'boolean', default: false },
        wait: { type: 'boolean', default: true },
        timeout_seconds: { type: 'integer', minimum: 1, maximum: 7200, default: 600 },
        run_id: { type: 'string', description: 'Run id from a prior submit (status/outputs)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'comfy_models',
    description: 'Model weight inventory on disk, grouped by folder (diffusion_models, vae, checkpoints, ...).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list'] },
        folder: { type: 'string', description: 'Restrict to one model folder' },
      },
      required: ['action'],
    },
  },
];

const server = new Server(
  { name: 'mnehmos.comfyui.mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const toolName = req.params.name;
  const raw = req.params.arguments ?? {};

  const tool = TOOLS.find((t) => t.name === toolName);
  if (!tool) throw new McpError(ErrorCode.InvalidParams, `unknown tool: ${toolName}`);

  const finish = (payload: unknown, isError: boolean, verdict: 'accepted' | 'rejected', detail: string) => {
    db.logCall(toolName, String((raw as { action?: string }).action ?? '-'), raw, verdict, detail);
    return { content: [{ type: 'text', text: JSON.stringify(payload, null, 1) }], isError };
  };

  try {
    if (toolName === 'comfy_server') {
      const args = ComfyServerArgsSchema.parse(raw);
      if (args.action === 'status') {
        const [stats, queue] = await Promise.all([client.systemStats(), client.queue()]);
        return finish({
          ok: true,
          endpoint: env.COMFYUI_URL,
          version: stats.system.comfyui_version,
          python: stats.system.python_version,
          devices: stats.devices.map((d) => ({
            name: d.name,
            vram_total_gb: +(d.vram_total / 1e9).toFixed(1),
            vram_free_gb: +(d.vram_free / 1e9).toFixed(1),
          })),
          queue: { running: queue.queue_running.length, pending: queue.queue_pending.length },
        }, false, 'accepted', 'status ok');
      }
      if (args.action === 'queue') {
        const q = await client.queue();
        return finish({
          ok: true,
          running: q.queue_running.length,
          pending: q.queue_pending.length,
        }, false, 'accepted', 'queue ok');
      }
      await client.interrupt();
      return finish({ ok: true, interrupted: true }, false, 'accepted', 'interrupt sent');
    }

    if (toolName === 'comfy_workflows') {
      const args = ComfyWorkflowsArgsSchema.parse(raw);
      if (args.action === 'list') {
        return finish({ ok: true, dir: env.COMFYUI_WORKFLOWS_DIR, workflows: listWorkflows(env.COMFYUI_WORKFLOWS_DIR) }, false, 'accepted', `${listWorkflows(env.COMFYUI_WORKFLOWS_DIR).length} workflows`);
      }
      if (args.action === 'get') {
        if (!args.name) return finish({ ok: false, error: 'name_required', detail: 'Provide the workflow file name.', retry_allowed: true }, true, 'rejected', 'missing name');
        try {
          return finish({ ok: true, name: args.name, workflow: readWorkflow(env.COMFYUI_WORKFLOWS_DIR, args.name) }, false, 'accepted', `fetched ${args.name}`);
        } catch (err) {
          return finish({ ok: false, error: 'workflow_not_found', detail: (err as Error).message, retry_allowed: true }, true, 'rejected', 'not found');
        }
      }
      // validate
      if (!args.content && !args.name) {
        return finish({ ok: false, error: 'workflow_required', detail: 'Provide name (library) or content (inline JSON).', retry_allowed: true }, true, 'rejected', 'nothing to validate');
      }
      let wf: unknown;
      try {
        wf = args.content ?? readWorkflow(env.COMFYUI_WORKFLOWS_DIR, args.name!);
      } catch (err) {
        return finish({ ok: false, error: 'workflow_not_found', detail: (err as Error).message, retry_allowed: true }, true, 'rejected', 'not found');
      }
      const objectInfo = await client.objectInfo();
      const verdict = validateWorkflow(wf, { objectInfo, modelsDir: env.COMFYUI_MODELS_DIR, inputDir: env.COMFYUI_INPUT_DIR });
      return finish({ ok: verdict.ok, gate: verdict }, !verdict.ok, verdict.ok ? 'accepted' : 'rejected', verdict.ok ? 'gate passed' : 'gate rejected');
    }

    if (toolName === 'comfy_render') {
      const args = ComfyRenderArgsSchema.parse(raw);
      let result;
      if (args.action === 'submit') {
        result = await renderSubmit(args, { env, client, db });
      } else if (args.action === 'status') {
        result = await renderStatus(args.run_id, { env, client, db });
      } else {
        result = await renderOutputs(args.run_id, { env, client, db });
      }
      return finish(result, !result.ok, result.ok ? 'accepted' : 'rejected', result.ok ? `${args.action} ok` : result.error);
    }

    if (toolName === 'comfy_models') {
      const args = ComfyModelsArgsSchema.parse(raw);
      const entries = listModels(env.COMFYUI_MODELS_DIR, args.folder);
      const totalBytes = entries.reduce((s, e) => s + e.size_bytes, 0);
      return finish({
        ok: true,
        dir: env.COMFYUI_MODELS_DIR,
        count: entries.length,
        total_gb: +(totalBytes / 1e9).toFixed(1),
        models: entries.map((e) => ({ ...e, size_gb: +(e.size_bytes / 1e9).toFixed(2) })),
      }, false, 'accepted', `${entries.length} models`);
    }

    throw new McpError(ErrorCode.InvalidParams, `unhandled tool: ${toolName}`);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return finish(
        { ok: false, error: 'invalid_arguments', detail: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), retry_allowed: true },
        true, 'rejected', 'schema rejection',
      );
    }
    if (err instanceof ComfyUnreachableError) {
      return finish(
        { ok: false, error: 'comfyui_unreachable', detail: err.detail, retry_allowed: true },
        true, 'rejected', 'unreachable',
      );
    }
    return finish(
      { ok: false, error: 'internal_error', detail: String(err), retry_allowed: true },
      true, 'rejected', 'internal',
    );
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  if (process.argv.includes('--self-test')) {
    console.error('[mnehmos.comfyui.mcp] stdio transport ready; self-test mode exiting.');
    await server.close();
    db.close();
    return;
  }
}

main().catch((err) => {
  console.error('[mnehmos.comfyui.mcp] fatal:', err);
  process.exit(1);
});
