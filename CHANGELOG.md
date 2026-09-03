# Changelog

## 0.1.0 — 2026-09-03

Initial release.

- `comfy_server` — status / queue / interrupt against the canonical endpoint
- `comfy_workflows` — library list (format detection), get, basics-gate validate
- `comfy_render` — submit (dry-run capable, server-owned seeds, provenance),
  status (DB + live), outputs (absolute paths)
- `comfy_models` — on-disk weight inventory by folder
- SQLite storage: `runs` (provenance) + `calls` (audit trail)
- 17 jest tests across 4 suites (gate, seeds, workflows, storage)
