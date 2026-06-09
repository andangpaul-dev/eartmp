# Phase 0 kickoff prompt (paste into Claude Code)

> Read `CLAUDE.md` and the three specs in `/docs`. We are starting **Phase 0:
> Solution Design** from the Build Sequence Document. Do **not** write any
> application code yet — Phase 0 is documentation only, and the BSD requires my
> approval before any code.
>
> Produce these deliverables as Markdown files under `docs/phase-0/`:
>
> 1. `solution-architecture.md` — architecture overview, layer
>    responsibilities, technology decisions (with rationale), security model
>    (Argon2, RBAC, record locking, encrypted backups), and the offline-first
>    strategy.
> 2. `erd.md` — entity-relationship diagram (Mermaid `erDiagram`) covering all
>    23 entities, relationships, cardinalities, and key constraints.
> 3. `database-design.md` — table definitions, indexes, constraints, soft-delete
>    convention, and the Prisma migration strategy.
> 4. `folder-structure.md` — the domain/application/infrastructure/presentation
>    layout and what belongs in each.
> 5. `coding-standards.md` — naming conventions, file organization, testing
>    requirements (Vitest, ≥80% coverage target), and the lint/format setup.
>
> When all five are drafted, post a short summary of key decisions and
> **stop for my approval.** Do not start Phase 1.

## Tips for the session

- If you already have a draft Prisma schema as reference, reconcile the ERD and
  database-design docs against it, but the _documents_ are the Phase 0
  deliverable — schema implementation is Phase 1.
- Keep each doc focused; link between them rather than repeating.
- Use Mermaid for the ERD so it renders in the repo host.
