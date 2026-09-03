# Schemas

Canonical data contracts live in code, not here:

- Tool input contracts: `src/schema/tools.ts` (Zod)
- Env contract: `src/schema/env.ts`
- Run / provenance / error contracts: `src/schema/contracts.ts`

The Zod definitions are the source of truth (docs-as-artifact: the schema IS
the documentation). Generated JSON Schema exports may be added here later —
nothing in this directory may disagree with `src/schema/`.
