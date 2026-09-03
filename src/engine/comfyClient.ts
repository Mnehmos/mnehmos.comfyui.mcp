/**
 * Thin HTTP client for the ComfyUI API (docs.comfy.org). No SDK, no state —
 * every method is one endpoint. Errors surface as ComfyUnreachableError so
 * handlers can map them to structured tool errors.
 */

export class ComfyUnreachableError extends Error {
  constructor(
    public readonly detail: string,
    public readonly cause?: unknown,
  ) {
    super(detail);
    this.name = 'ComfyUnreachableError';
  }
}

async function getJson<T>(baseUrl: string, path: string, timeoutMs = 10000): Promise<T> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new ComfyUnreachableError(`${path} -> HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ComfyUnreachableError) throw err;
    throw new ComfyUnreachableError(`cannot reach ComfyUI at ${baseUrl}${path}`, err);
  }
}

async function postJson<T>(baseUrl: string, path: string, body: unknown, timeoutMs = 15000): Promise<T> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ComfyUnreachableError(`${path} -> HTTP ${res.status}: ${text.slice(0, 400)}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ComfyUnreachableError) throw err;
    throw new ComfyUnreachableError(`cannot reach ComfyUI at ${baseUrl}${path}`, err);
  }
}

export interface SystemStats {
  system: {
    comfyui_version: string;
    python_version: string;
    os: string;
    ram_total: number;
    ram_free: number;
    [k: string]: unknown;
  };
  devices: Array<{
    name: string;
    type: string;
    vram_total: number;
    vram_free: number;
    [k: string]: unknown;
  }>;
}

export interface ObjectInfoNodeDef {
  input?: {
    required?: Record<string, unknown[]>;
    optional?: Record<string, unknown[]>;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
export type ObjectInfo = Record<string, ObjectInfoNodeDef>;

export interface QueueInfo {
  queue_running: Array<unknown[]>;
  queue_pending: Array<unknown[]>;
}

export interface HistoryEntry {
  prompt: Array<unknown>;
  outputs: Record<string, Record<string, unknown>>;
  status: {
    status_str: string;
    completed: boolean;
    messages: Array<unknown[]>;
    [k: string]: unknown;
  };
}

export interface PromptResponse {
  prompt_id: string;
  number: number;
  node_errors?: Record<string, unknown>;
}

export function createComfyClient(baseUrl: string) {
  return {
    systemStats: () => getJson<SystemStats>(baseUrl, '/system_stats'),
    objectInfo: () => getJson<ObjectInfo>(baseUrl, '/object_info', 30000),
    queue: () => getJson<QueueInfo>(baseUrl, '/queue'),
    history: (promptId: string) =>
      getJson<Record<string, HistoryEntry>>(baseUrl, `/history/${encodeURIComponent(promptId)}`),
    prompt: (workflow: Record<string, unknown>, clientId: string) =>
      postJson<PromptResponse>(baseUrl, '/prompt', { prompt: workflow, client_id: clientId }),
    interrupt: () => postJson<unknown>(baseUrl, '/interrupt', {}),
  };
}
export type ComfyClient = ReturnType<typeof createComfyClient>;
