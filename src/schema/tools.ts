/**
 * Tool input contracts. Four consolidated action-enum tools
 * (vibe-coders-bible ch.9/ch.25: few broad tools, explicit enums, dry-run).
 */
import { z } from 'zod';

export const ComfyServerArgsSchema = z.object({
  action: z.enum(['status', 'queue', 'interrupt']),
});
export type ComfyServerArgs = z.infer<typeof ComfyServerArgsSchema>;

export const ComfyWorkflowsArgsSchema = z.object({
  action: z.enum(['list', 'get', 'validate']),
  /** Workflow file name inside COMFYUI_WORKFLOWS_DIR (for get/validate by name). */
  name: z.string().optional(),
  /** Inline workflow JSON object (for validate without a file). */
  content: z.record(z.unknown()).optional(),
});
export type ComfyWorkflowsArgs = z.infer<typeof ComfyWorkflowsArgsSchema>;

export const ComfyRenderArgsSchema = z.object({
  action: z.enum(['submit', 'status', 'outputs']),
  /** Inline API-format workflow to render (submit only). */
  workflow: z.record(z.unknown()).optional(),
  /** Workflow file name inside COMFYUI_WORKFLOWS_DIR to render (submit only). */
  workflow_name: z.string().optional(),
  /**
   * Master seed. Omit to let the server generate one (doctrine: the server
   * owns randomness). Supply only to replay a prior run exactly.
   */
  master_seed: z.number().int().min(0).max(2 ** 31 - 1).optional(),
  /** Validate + report the plan without queueing (default false). */
  dry_run: z.boolean().default(false),
  /** Block until the run finishes (default true; status polling otherwise). */
  wait: z.boolean().default(true),
  /** Max seconds to wait when wait=true (default 600). */
  timeout_seconds: z.number().int().min(1).max(7200).default(600),
  /** Run id from a prior submit (status/outputs only). */
  run_id: z.string().optional(),
});
export type ComfyRenderArgs = z.infer<typeof ComfyRenderArgsSchema>;

export const ComfyModelsArgsSchema = z.object({
  action: z.literal('list'),
  /** Restrict to one model folder (e.g. "diffusion_models"); omit for all. */
  folder: z.string().optional(),
});
export type ComfyModelsArgs = z.infer<typeof ComfyModelsArgsSchema>;
