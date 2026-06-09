# Phase 1 — Project & Database Foundation

**Project:** EARTMP · **Phase:** 1 · **Status:** Plan drafted, awaiting approval
to implement · **Predecessor:** Phase 0 (approved)

> This is the **deliverables-before-implementation** spec for Phase 1, in the
> mandated output format. Nothing here is built until you approve. Phase 1 adds
> **no business features** — only the foundation that every later phase stands on.

---

## Executive Summary

Phase 1 converts the existing domain-core slice into a **production-grade,
buildable application skeleton**: enforced layer boundaries, a working Prisma
migration + idempotent seed, the full quality toolchain (ESLint, Prettier,
Vitest with coverage, CI), and an **architecture fitness test** that fails the
build if Clean Architecture is violated. It deliberately stops short of auth,
records, or UI features.

---

## Objectives

1. Establish the canonical `src/` layer layout with **enforced** import
   boundaries (lint rule + fitness test).
2. Make the 23-table schema **migratable and seedable** (`prisma migrate` +
   idempotent seed), with the recommended indexes and the soft-delete/unique
   resolution from Phase 0.
3. Stand up the **quality gates**: strict `tsc`, ESLint, Prettier, Vitest
   coverage (≥80%), and a CI pipeline running all four.
4. Provide the **composition root / DI** scaffolding (no business wiring yet).
5. Initialise the repo for disciplined delivery (git, conventional commits,
   pre-commit hooks).

**Out of scope (later phases):** authentication/RBAC (P2), institution/settings
(P3), engines as app code (P4), any UI screens, any records/results logic.

---

## Deliverables

| #   | Deliverable                            | Notes                                                                                                                                                                           |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `git` initialised + `.gitignore`       | repo currently not a git repo; add `node_modules`, `dev.db`, `dist`, `.env`.                                                                                                    |
| D2  | Toolchain config                       | `eslint.config.js`, `.prettierrc`, `vitest.config.ts`, updated `tsconfig.json` (strict family + path aliases).                                                                  |
| D3  | **Layer-boundary lint rules**          | `import/no-restricted-paths` (or `eslint-plugin-boundaries`) enforcing the dependency rule.                                                                                     |
| D4  | **Architecture fitness test**          | `tests/architecture.test.ts` scans `src/domain/**` for forbidden imports (React/Prisma/Tauri) and fails CI.                                                                     |
| D5  | `src/` skeleton                        | `domain/`, `application/`, `infrastructure/` (with `db/`, `repositories/`, `di/`), `presentation/` placeholders matching [folder-structure.md](../phase-0/folder-structure.md). |
| D6  | Prisma migration                       | initial migration from `prisma/schema.prisma`; raw-SQL addendum for partial unique indexes + recommended secondary indexes.                                                     |
| D7  | **Idempotent seed** (`prisma/seed.ts`) | default roles/permissions (catalog placeholder), default `GradeScale`, default `AssessmentConfig`, Transcript Template V1 stub, `Institution` row. Re-runnable safely.          |
| D8  | DI composition root                    | `infrastructure/di/` wiring scaffold (registers ports → impls; empty until P2+).                                                                                                |
| D9  | CI workflow                            | `prettier --check` → `eslint` → `tsc --noEmit` → `vitest run --coverage`.                                                                                                       |
| D10 | Pre-commit hooks                       | Husky + lint-staged (Prettier + ESLint on staged).                                                                                                                              |
| D11 | `package.json` scripts                 | `lint`, `format`, `typecheck`, `test`, `test:coverage`, `db:migrate`, `db:seed`.                                                                                                |
| D12 | `/docs` update                         | mark Phase 1 status; note any deviations.                                                                                                                                       |

---

## Architecture Decisions

- **AD1 — Path aliases** (`@domain/*`, `@app/*`, `@infra/*`, `@ui/*`) in
  `tsconfig` + `vitest` to make boundary intent legible and lint rules simple.
- **AD2 — Boundary enforcement is mechanical, not cultural.** Both an ESLint
  rule _and_ a runtime fitness test, so a violation breaks CI two ways.
- **AD3 — Partial unique indexes** `WHERE deletedAt IS NULL` for user-facing
  codes (`Course.code`, etc.) via a raw-SQL migration step (Phase 0 DB design §6,
  decision now taken).
- **AD4 — Seed is idempotent & environment-aware** (dev sample data gated behind
  a flag; only essential config seeded in all environments).
- **AD5 — Composition root is the only place that names concrete classes**;
  everything else depends on interfaces.
- **AD6 — Keep `reference-implementation/` out of the build graph** (tsconfig
  excludes it); it remains reference for P4/P7/P9.

---

## Database Changes

- **Migration `init`** generated from the existing 23-table schema (no schema
  shape changes in P1).
- **Index addendum** (raw SQL in the migration): the `[ADD]` secondary indexes
  from [database-design.md](../phase-0/database-design.md) §4 and **partial
  unique indexes** for soft-deleted rows (§6).
- **Seed rows:** RBAC catalog (placeholder), one default `GradeScale`, one
  default `AssessmentConfig`, one `TranscriptTemplate` (V1 stub), one
  `Institution`.
- No data destruction; migration is additive and reversible.

> **R-3 reminder:** `prisma generate`/`migrate` need network to Prisma's binary
> host the first time. Implementation will run generation in a connected step and
> document the offline cache, per [environment-setup.md](../phase-0/environment-setup.md).

---

## UI Screens

**None.** Phase 1 may include at most a bare app-shell placeholder (no business
screens). UI begins in Phase 2 (Login).

---

## Services

**No business services.** Only infrastructure scaffolding:

- `PrismaClient` singleton (`infrastructure/db/prisma.ts`).
- DI registry scaffold (`infrastructure/di/`).
- A `ClockPort` interface (so later phases avoid `Date.now()` flakiness) — interface only.

---

## Validation Rules

- `tsconfig` strict family: `strict`, `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`.
- ESLint: no `any`, import-order, **layer boundaries**, React/hooks (for later).
- Prettier: 2-space, double quotes, semicolons, trailing commas.
- Coverage threshold: **≥80%** enforced in `vitest.config.ts`.

---

## Test Plan

| Test                           | Type        | Asserts                                                                        |
| ------------------------------ | ----------- | ------------------------------------------------------------------------------ |
| `architecture.test.ts`         | fitness     | `src/domain/**` imports nothing from React/Prisma/Tauri/outer layers.          |
| boundary-violation fixture     | fitness     | a deliberately bad import makes the suite **fail** (proves enforcement works). |
| migration apply                | integration | `init` migration applies cleanly to a throwaway SQLite DB.                     |
| seed idempotency               | integration | running the seed twice yields no duplicates/errors.                            |
| partial-unique-index           | integration | re-creating a code after soft-delete succeeds; duplicate live code fails.      |
| existing engine/use-case suite | unit        | still green, still no DB/UI (regression guard).                                |
| coverage gate                  | meta        | CI fails below 80%.                                                            |

---

## Risks

| ID   | Risk                                                                             | Mitigation                                                            |
| ---- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| R-3  | Prisma binary download blocked offline                                           | run generate in connected step; cache engines; document mirror.       |
| R-1  | Reconstructed assumptions (RBAC catalog, default scale) may differ from real SDP | seed values are placeholders, clearly flagged, trivially replaceable. |
| P1-a | Boundary lint false-negatives                                                    | back lint with the runtime fitness test (AD2).                        |
| P1-b | Partial-unique raw SQL drifts from Prisma model                                  | migration test (§Test Plan) guards it.                                |

---

## Completion Criteria

- [ ] `npm install`, `npm run typecheck`, `npm test`, `npm run lint`,
      `npm run format -- --check` all pass locally and in CI.
- [ ] `prisma migrate` applies cleanly; seed is idempotent (test-proven).
- [ ] Architecture fitness test passes **and** the bad-import fixture fails as
      designed.
- [ ] Coverage ≥ 80%.
- [ ] No business features, no UI screens, no future-phase code present.
- [ ] `/docs` updated; summary posted; **approval requested before Phase 2.**

---

## Approval Checklist (to start Phase 1 implementation)

- [ ] Phase 1 scope approved as written (or amended).
- [ ] Seed/RBAC placeholders acceptable until real SDP arrives.
- [ ] Partial-unique-index decision (AD3) confirmed.
- [ ] Go-ahead given to write Phase 1 implementation code.

_Related: [Phase 0 index](../phase-0/README.md) ·
[folder-structure.md](../phase-0/folder-structure.md) ·
[database-design.md](../phase-0/database-design.md) ·
[implementation-plan.md](../phase-0/implementation-plan.md)_
