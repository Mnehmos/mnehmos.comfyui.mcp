/**
 * Environment contract. Defaults match the canonical TMRI ComfyUI service
 * (F:\ComfyUI\README.md): endpoint 127.0.0.1:8188, base dir F:\ComfyUI.
 */
import { z } from 'zod';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const EnvSchema = z.object({
  COMFYUI_URL: z.string().url().default('http://127.0.0.1:8188'),
  COMFYUI_WORKFLOWS_DIR: z.string().default('F:/ComfyUI/workflows'),
  COMFYUI_MODELS_DIR: z.string().default('F:/ComfyUI/models'),
  COMFYUI_INPUT_DIR: z.string().default('F:/ComfyUI/input'),
  COMFYUI_OUTPUT_DIR: z.string().default('F:/ComfyUI/output'),
  COMFYUI_MCP_DB: z.string().default(path.join(packageRoot, 'data', 'comfyui-mcp.db')),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(processEnv: NodeJS.ProcessEnv = process.env): Env {
  // .env file support without a dependency: simple KEY=VALUE lines.
  const parsed = EnvSchema.safeParse(processEnv);
  // Fall back to defaults for anything missing/invalid rather than crashing
  // the server at import time (bible: structured feedback, not silence).
  const merged = { ...EnvSchema.parse({}), ...(parsed.success ? parsed.data : {}) };
  // A relative DB path would resolve against the spawn cwd; servers are
  // registered globally and spawned from anywhere, so anchor it to the
  // package root.
  if (!path.isAbsolute(merged.COMFYUI_MCP_DB)) {
    merged.COMFYUI_MCP_DB = path.resolve(packageRoot, merged.COMFYUI_MCP_DB);
  }
  return merged;
}
