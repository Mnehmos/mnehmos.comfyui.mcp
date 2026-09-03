/**
 * Canonical data contracts (vibe-coders-bible ch.16: schemas are contracts).
 * Every tool response is one of these shapes; every failure is a ToolError.
 */
import { z } from 'zod';

export const ToolErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(), // machine code, e.g. "workflow_not_found"
  field: z.string().optional(),
  detail: z.string(),
  retry_allowed: z.boolean(),
});
export type ToolError = z.infer<typeof ToolErrorSchema>;

export function toolError(
  error: string,
  detail: string,
  opts: { field?: string; retry_allowed?: boolean } = {},
): ToolError {
  return {
    ok: false as const,
    error,
    detail,
    field: opts.field,
    retry_allowed: opts.retry_allowed ?? false,
  };
}

export const WorkflowFormatSchema = z.enum(['api', 'ui', 'unknown']);
export type WorkflowFormat = z.infer<typeof WorkflowFormatSchema>;

export const ValidationIssueSchema = z.object({
  code: z.string(),
  node_id: z.string().optional(),
  detail: z.string(),
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export const GateVerdictSchema = z.object({
  format: WorkflowFormatSchema,
  ok: z.boolean(),
  node_count: z.number(),
  errors: z.array(ValidationIssueSchema),
  warnings: z.array(ValidationIssueSchema),
});
export type GateVerdict = z.infer<typeof GateVerdictSchema>;

export const ProvenanceSchema = z.object({
  run_id: z.string(),
  prompt_id: z.string(),
  workflow_name: z.string().nullable(),
  workflow_hash: z.string(), // sha256 of the submitted workflow JSON
  master_seed: z.number().int(),
  seeds: z.array(z.object({ node_id: z.string(), input_name: z.string(), seed: z.number().int() })),
  comfy_version: z.string(),
  submitted_at: z.string(),
  finished_at: z.string().nullable(),
  outputs: z.array(
    z.object({
      filename: z.string(),
      subfolder: z.string(),
      type: z.string(),
      absolute_path: z.string().optional(),
    }),
  ),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;
