# Phase 1 — Implementation Notes & Verification

**Status:** Implemented. All quality gates green. **Awaiting approval to start
Phase 2.**

This records what was built against [phase-1-plan.md](phase-1-plan.md), the
verification evidence, and two deviations that need your sign-off.

---

## Verification evidence (commands actually run)

| Gate             | Command                                       | Result                                                                                    |
| ---------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Type-check       | `npm run typecheck` (`tsc --noEmit`, strict)  | **clean**                                                                                 |
| Lint             | `npm run lint` (ESLint flat + boundary rules) | **0 errors, 0 warnings**                                                                  |
| Format           | `npm run format:check` (Prettier)             | **all files conform**                                                                     |
| Tests            | `npm run test`                                | **47 passed / 47**                                                                        |
| Coverage         | `npm run test:coverage`                       | **stmts 97.6% · branch 96.7% · funcs 100% · lines 97.6%** (gate ≥80%)                     |
| Migration        | `prisma migrate dev --name init`              | applied; `prisma/migrations/<ts>_init/` created                                           |
| Seed idempotency | `npm run db:seed` ×2                          | counts stable (roles 4, perms 11, rolePerms 24, scale/config/template/institution 1 each) |
| Indexes          | `grep "CREATE INDEX" migration.sql`           | all 10 recommended secondary indexes present                                              |

Prisma client generated (`prisma generate`) successfully on this machine, so
risk **R-3** (offline binary host) did **not** bite here; CI runs generate too.

---

## Deliverables built

- **D1** `git init` + `.gitignore` (+ `.env.example`). _(Repo initialised; no
  commit made — I commit only when you ask.)_
- **D2** Toolchain: `tsconfig.json` (strict family + path aliases
  `@domain/@app/@infra/@ui`), `eslint.config.js` (flat), `.prettierrc`,
  `vitest.config.ts` (coverage gate).
- **D3** Layer-boundary lint via `import/no-restricted-paths` + a framework-import
  ban on `domain`/`application`.
- **D4** `tests/architecture.test.ts` — scans the layers for forbidden imports
  **and self-verifies** by feeding synthetic bad sources to the detector (the
  "bad-import fixture" without shipping a build-breaking file).
- **D5** `src/` skeleton (existing domain core retained; added
  `application/ports/`, `infrastructure/db|repositories|di/`, `presentation/`).
- **D6** Initial migration from the 23-table schema **+ 10 secondary indexes**
  (added to `schema.prisma` as `@@index`). _(Partial unique indexes — see
  Deviation 2.)_
- **D7** `prisma/seed.ts` — idempotent (upserts), seeds RBAC placeholder catalog,
  default grade scale, default assessment config, Transcript Template V1 stub,
  Institution row.
- **D8** `infrastructure/di/container.ts` — DI composition root (empty registry
  in P1; unit-tested).
- **D9** `.github/workflows/ci.yml` — format → lint → typecheck → coverage.
- **D10** Husky `pre-commit` + `lint-staged`.
- **D11** `package.json` scripts (`lint`, `format`, `typecheck`, `test`,
  `test:coverage`, `db:*`).
- **D12** This doc + status updates.

New tests added beyond the existing reference suite: `architecture.test.ts` (9),
`container.test.ts` (4), `engine-branches.test.ts` (18) — the latter covers the
engines' validation/edge branches to clear the coverage gate honestly.

---

## Deviations from the approved plan (need sign-off)

### Deviation 1 — Prisma pinned to **v6**, not v7

The schema and all Phase 0 docs assume the classic
`datasource { url = env("DATABASE_URL") }` + `prisma migrate dev` workflow.
**Prisma 7 removed that** — it now requires a `prisma.config.ts` and a driver
adapter passed to `PrismaClient`. To keep the documented schema/migrate flow
working, `prisma`/`@prisma/client` are pinned to `^6.2.0` (resolved 6.19.3),
which generated, migrated, and seeded cleanly.

- **Alternative if you prefer v7:** adopt `prisma.config.ts` + a SQLite driver
  adapter (e.g. `@prisma/adapter-better-sqlite3`) and pass it to the client. This
  is a small, self-contained change we can take in a later phase. _Recommend
  staying on v6 for now (stable, matches the docs); revisit at hardening (P19)._

### Deviation 2 — Partial unique indexes **deferred** (was AD3)

The plan (AD3) called for partial unique indexes (`WHERE deletedAt IS NULL`) so a
soft-deleted row's code can be reused. During implementation this proved coupled
to work that doesn't exist yet: Prisma's `@unique` is unconditional, so a true
soft-delete-friendly unique requires **dropping `@unique`** and managing
uniqueness via a raw partial index **plus** repository-level checks — and
dropping `@unique` also breaks the `where: { code }` upserts the seed/repositories
rely on. Implementing it now, before the repositories (P5–P7) exist, would be
future-phase work.

- **Done now:** all recommended **secondary** indexes (the performance ones).
- **Deferred to P5/P6** (when soft-delete-then-recreate is actually exercised):
  the partial-unique change, implemented alongside the repositories that depend
  on it. The Phase 0 DB-design §6 note already flags this.
- **Confirm:** OK to defer, or do you want the partial-unique raw-SQL migration
  authored now despite the upsert implications?

---

## Definition of Done (CLAUDE.md) — checklist

- [x] Deliverables exist.
- [x] Tests written and passing (47/47).
- [x] `tsc --noEmit` clean (strict).
- [x] Architecture boundaries intact (lint rule + fitness test enforce it).
- [x] `/docs` updated.
- [x] Summary posted and approval requested.
- [x] No business features / no future-phase code.

_Next: Phase 2 — Authentication & RBAC (only on your approval)._
