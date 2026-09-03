# mnehmos.comfyui.mcp

MCP server for the local ComfyUI render service. One server, four consolidated
tools, full provenance. Built per `vibe-coders-bible` doctrine (ch. 9 safer
tools, ch. 25 model-narrates/engine-rules, ch. 28 state-first/pixels-second).

## What it does

| Tool | Actions | Purpose |
|---|---|---|
| `comfy_server` | `status`, `queue`, `interrupt` | Service health: version, VRAM, queue depth; cancel current render |
| `comfy_workflows` | `list`, `get`, `validate` | Workflow library in `COMFYUI_WORKFLOWS_DIR`; basics gate (node types exist, required inputs present, model files on disk) |
| `comfy_render` | `submit`, `status`, `outputs` | Validate → seed → queue → track. `dry_run` plans without queueing; every run recorded with provenance |
| `comfy_models` | `list` | Weight inventory on disk by folder |

## Doctrine mapping

- **Basics gate before compute** — `comfy_render submit` and `validate` check
  format, node types against live `/object_info`, required inputs, and model
  file existence *before* anything is queued (state first, pixels second).
- **Server owns randomness** — the LLM never supplies seeds. A master seed is
  generated server-side (crypto random) unless you pass `master_seed` to
  replay a prior run exactly. Per-sampler seeds derive deterministically from
  `(master_seed, node_id)`; everything is logged.
- **Provenance** — every run records: run id, prompt id, workflow name+hash,
  master seed, derived seeds, ComfyUI version, timestamps, outputs with
  absolute paths. Stored in SQLite (`runs` table), not conversation context.
- **Structured failure** — rejections return
  `{ok:false, error:"<machine_code>", detail, retry_allowed, ...}` with the
  gate verdict attached; never silence.
- **Audit trail** — every tool call, accepted or rejected, lands in the
  `calls` table with arguments and verdict.
- **Dry-run** — `comfy_render submit {dry_run:true}` runs the full gate and
  seed plan, queues nothing.

## Setup

```bash
npm install
npm run build
npm test
```

Defaults point at the canonical service (`http://127.0.0.1:8188`, base
`F:\ComfyUI`) — see `F:\ComfyUI\README.md`, the source of truth for the
endpoint. Override via env (`.env.example` documents all variables).

## Registration

Repo-local (`.mcp.json`):

```json
{
  "mcpServers": {
    "comfyui": {
      "command": "<node>",
      "args": ["F:\\Github\\mnehmos.comfyui.mcp\\dist\\index.js"],
      "description": "comfyui: render + manage ComfyUI workflows — status, validate, seeded renders, model inventory"
    }
  }
}
```

Also registered in the workspace root `F:\Github\.mcp.json`.

## Workflow format

`comfy_render submit` takes **API-format** JSON (`{nodeId: {class_type, inputs}}`).
Export from the ComfyUI editor via *Workflow → Export (API)* and drop the file
into `F:\ComfyUI\workflows\`. UI-format files are listed by `comfy_workflows`
but rejected by the gate with guidance (by design — the editor format is not
what `/prompt` accepts).

## Layout

```
src/schema/     Zod contracts: tool inputs, env, run/provenance/error shapes
src/engine/     comfyClient (HTTP), gates (basics gate), seedService, workflows, models, render
src/storage/    SQLite runs + audit trail (better-sqlite3)
test/           jest suites + fixtures (no live server needed)
schemas/        exported JSON contracts (docs-as-artifact)
```

## Commands

`npm run build` · `npm start` · `npm test` · `npm run smoke` (self-test boot)
