# Presentation layer (placeholder)

React 19 + Tauri UI lives here from Phase 2 onward. It depends on **application
use-cases only** (through the IPC façade) and must never import
`src/infrastructure/**` or Prisma directly — enforced by the ESLint boundary
rule and `tests/architecture.test.ts`.

See [docs/phase-0/folder-structure.md](../../docs/phase-0/folder-structure.md).
