# AGENTS.md — mnehmos.comfyui.mcp

## Project overview
MCP server exposing the local ComfyUI render service (`http://127.0.0.1:8188`)
as four consolidated tools: `comfy_server`, `comfy_workflows`, `comfy_render`,
`comfy_models`. TypeScript + Zod + better-sqlite3, stdio transport.

## Primary constraint
The ComfyUI endpoint is **standardized** at `127.0.0.1:8188` (see
`F:\ComfyUI\README.md`). Never hardcode another URL; read env with defaults
from `src/schema/env.ts`.

## Verification command
```
npm run build && npm test
```
Every PR must pass both. Tests run without a live ComfyUI.

## Scope limits
- The server validates and orchestrates; it does not reimplement ComfyUI.
- No seeds from the model, ever — `src/engine/seedService.ts` owns randomness.
- Secrets never enter prompts or logs; runtime config via `.env` (gitignored).

## Key files
| File | Role |
|---|---|
| `src/index.ts` | Tool registration, dispatch, audit, error mapping |
| `src/engine/gates.ts` | Basics gate — runs before any queued compute |
| `src/engine/render.ts` | Submit/status/outputs orchestration + provenance |
| `src/engine/seedService.ts` | Server-owned seeds, deterministic derivation |
| `src/storage/db.ts` | `runs` + `calls` tables (SQLite) |
| `src/schema/tools.ts` | Tool input contracts (action enums) |

## Do not touch
- `data/` (runtime DB), the canonical ComfyUI service, `F:\ComfyUI\README.md`.

## Session start checklist
1. `npm run build && npm test` — confirm green before changing anything.
2. Is ComfyUI up? `curl http://127.0.0.1:8188/system_stats` (not required for tests).
3. Doctrine reference: `F:\Github\vibe-coders-bible` ch. 9 / 25 / 28.
