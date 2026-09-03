/**
 * Workflow library scanning + format detection.
 * API format: { "<id>": { class_type, inputs } } — what POST /prompt takes.
 * UI format:  { nodes: [...], links: [...] } — what the editor saves.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { WorkflowFormat } from '../schema/contracts.js';

export interface WorkflowSummary {
  name: string;
  format: WorkflowFormat;
  size_bytes: number;
  modified_at: string;
}

export function detectFormat(wf: unknown): WorkflowFormat {
  if (wf && typeof wf === 'object' && !Array.isArray(wf)) {
    const rec = wf as Record<string, unknown>;
    if (Array.isArray(rec.nodes) && Array.isArray(rec.links)) return 'ui';
    const values = Object.values(rec);
    if (
      values.length > 0 &&
      values.every((v) => v && typeof v === 'object' && 'class_type' in (v as object))
    ) {
      return 'api';
    }
  }
  return 'unknown';
}

export function workflowHash(wf: unknown): string {
  return createHash('sha256').update(JSON.stringify(wf, null, 1)).digest('hex');
}

export function listWorkflows(dir: string): WorkflowSummary[] {
  if (!fs.existsSync(dir)) return [];
  const out: WorkflowSummary[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isFile() || !ent.name.endsWith('.json')) continue;
    const full = path.join(dir, ent.name);
    let format: WorkflowFormat = 'unknown';
    try {
      format = detectFormat(JSON.parse(fs.readFileSync(full, 'utf-8')));
    } catch {
      format = 'unknown';
    }
    const st = fs.statSync(full);
    out.push({
      name: ent.name,
      format,
      size_bytes: st.size,
      modified_at: st.mtime.toISOString(),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function readWorkflow(dir: string, name: string): Record<string, unknown> {
  // Reject path traversal: only bare file names inside the workflows dir.
  const safe = path.basename(name);
  if (safe !== name) throw new Error('workflow name must be a bare file name');
  const full = path.join(dir, safe);
  if (!full.startsWith(path.resolve(dir))) throw new Error('workflow outside library dir');
  if (!fs.existsSync(full)) throw new Error(`workflow not found: ${safe}`);
  return JSON.parse(fs.readFileSync(full, 'utf-8')) as Record<string, unknown>;
}
