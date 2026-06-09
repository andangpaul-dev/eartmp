# Phase 7 — Implementation Notes & Verification

**Status:** Implemented (Option A — persistence foundation now, Tauri-SQL in the
shell phase). All gates green. **Awaiting approval to start the next phase.**

Approved: Option A; optimistic locking on `Result`/`Student`/`Transcript`
(implemented for Student now); reconcile the Course ports; integration tests
against a temp DB.

---

## Verification evidence (commands run)

| Gate                | Command                    | Result                                                                                           |
| ------------------- | -------------------------- | ------------------------------------------------------------------------------------------------ |
| Type-check          | `npm run typecheck`        | **clean**                                                                                        |
| Lint (+ boundaries) | `npm run lint`             | **0 errors**                                                                                     |
| Format              | `npm run format:check`     | **conforms**                                                                                     |
| Tests               | `npm run test:coverage`    | **144 passed** (incl. real-DB integration); stmts **93.7%** · branch **91.4%** · funcs **87.2%** |
| Integration         | part of suite              | temp SQLite DB migrated fresh; UoW commit/rollback, optimistic lock, AdmitStudent atomic         |
| End-to-end demo     | `npm run demo:persistence` | ✓ UoW commit · ✓ rollback (F-1) · ✓ optimistic-lock conflict (F-27)                              |

---

## What was built

- **`UnitOfWork` port** (`application/ports/UnitOfWork.ts`) + `TransactionalRepos`
  bundle; **`PrismaUnitOfWork`** (`infrastructure/persistence/`) using interactive
  `$transaction`. Multi-write use-cases run atomically (**fixes F-1**).
- **`ConcurrencyError`** + **optimistic locking** (`VersionedStudentWrites`):
  `UPDATE ... WHERE id = ? AND version = ?` + increment; zero rows ⇒
  `ConcurrencyError` (**addresses F-27**, using the Phase 5 `version` columns).
- **`AdmitStudent`** — atomic create-student + initial-enrollment use-case (the
  clean F-1 demonstrator).
- **`ProcessSemesterResults` reworked** to run its writes inside `uow.run` (the
  literal F-1 example is now atomic) and to record grade provenance (`gradeScaleId`,
  F-19).
- **Port reconciliation:** retired the legacy generic `StudentRepository`/
  `CourseRepository`/`ResultRepository` from `repositories/index.ts`; the
  canonical paginated ports in `records.ts` are the single source (added
  `ResultRepository` + `VersionedStudentWrites` there). The reference use-case +
  its test now use the canonical ports + a fake `UnitOfWork`.
- **Tx-capable repos:** Prisma records repos + the audit adapter now accept a
  `Prisma.TransactionClient`, so the same repo classes run standalone or inside a
  transaction (a full `PrismaClient` is assignable). Added `PrismaResultRepository`.
- **DI wiring** (`infrastructure/di/wiring.ts`): `wirePersistence(container, db)`
  registers the dev repos + UoW under typed `TOKENS` (leaves the Phase 1 empty
  `buildContainer` intact).
- **Integration tests** (`tests/integration/persistence.integration.test.ts`):
  spin up a **throwaway SQLite DB** (`prisma migrate deploy` → `PrismaClient({
datasourceUrl })`), prove UoW commit + rollback + optimistic conflict +
  AdmitStudent atomicity, torn down after.
- **`scripts/demo-persistence.ts`** (`npm run demo:persistence`).
- **Tauri-SQL implementation spec** ([tauri-sql-spec.md](tauri-sql-spec.md)) for
  the shell phase.

---

## Decisions honoured / deviations

- **Option A** taken: the Tauri-SQL runtime layer is **deferred to a dedicated
  shell phase**; Phase 7 delivered the persistence _patterns_ + a spec so that
  work is mechanical. ADR-007 is unchanged.
- **F-1 fixed** (atomic multi-write); **F-27 addressed** (optimistic locking,
  implemented for Student; Result/Transcript share the same `version` mechanism
  and adopt it when their write use-cases land in Phases 9/12).
- **Course ports reconciled** to one canonical set (the Phase 6 debt is paid).
- Integration tests add ~20s to the suite (one `prisma migrate deploy`); worth it
  for real-DB proof. CI already runs `prisma generate`, so `migrate deploy` works.

---

## Definition of Done (CLAUDE.md)

- [x] `UnitOfWork` + optimistic locking; multi-write use-cases atomic (F-1).
- [x] Course ports reconciled; reference use-case migrated; suites green.
- [x] Integration tests (atomic rollback + version conflict) pass against a temp DB.
- [x] `demo:persistence` shows commit, rollback, and a version conflict.
- [x] Tests pass (144); coverage ≥80% (93.7%); `tsc` strict clean; lint/format clean.
- [x] `/docs` updated incl. the Tauri-SQL implementation spec.
- [x] Summary posted; approval requested before the next phase.

_Next: the **Shell phase** (Tauri + React bring-up + Tauri-SQL repos per the
spec) OR continue with **Phase 8 — Assessment & Grading Config UI-less logic**.
Recommend confirming sequencing given UI has been deferred throughout._
