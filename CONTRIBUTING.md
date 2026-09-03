# Contributing

Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, scope allowed).

Before every PR:

```bash
npm run build && npm test
```

Rules of engagement for this repo:

1. **Schemas first.** New tool inputs start in `src/schema/tools.ts` (Zod) —
   the schema is the contract; regenerate `schemas/` exports when they change.
2. **Gates before compute.** Anything that queues work on ComfyUI must pass
   (or explicitly bypass, with a recorded reason) the basics gate.
3. **Seeds belong to the server.** Never add a tool parameter that lets the
   model pick a seed, except explicit `master_seed` replay.
4. **Audit everything.** Every new tool call path must flow through
   `db.logCall` — accepted or rejected.
5. **Structured failure.** No thrown strings; return
   `{ok:false, error, detail, retry_allowed}` shapes.

New remotes default to private (TMRI workspace standards, `F:\Github\STANDARDS.md`).
