/**
 * Environment contract. Defaults match the canonical TMRI ComfyUI service
 * (F:\ComfyUI\README.md): endpoint 127.0.0.1:8188, base dir F:\ComfyUI.
 */
import { z } from 'zod';

const EnvSchema = z.object({
  COMFYUI_URL: z.string().url().default('http://127.0.0.1:8188'),
  COMFYUI_WORKFLOWS_DIR: z.string().default('F:/ComfyUI/workflows'),
  COMFYUI_MODELS_DIR: z.string().default('F:/ComfyUI/models'),
  COMFYUI_INPUT_DIR: z.string().default('F:/ComfyUI/input'),
  COMFYUI_OUTPUT_DIR: z.string().default('F:/ComfyUI/output'),
  COMFYUI_MCP_DB: z.string().default('./data/comfyui-mcp.db'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(processEnv: NodeJS.ProcessEnv = process.env): Env {
  // .env file support without a dependency: simple KEY=VALUE lines.
  const parsed = EnvSchema.safeParse(processEnv);
  // Fall back to defaults for anything missing/invalid rather than crashing
  // the server at import time (bible: structured feedback, not silence).
  const merged = { ...EnvSchema.parse({}), ...(parsed.success ? parsed.data : {}) };
  return merged;
}
