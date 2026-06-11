# Phase 8 — Implementation Notes & Verification

**Status:** Implemented. All gates green. **Awaiting approval to start Phase 9.**

Approved: grade-scale + assessment-structure management (logic only); single
default per type + guarded delete; new `config.read`; standing bands stay in the
existing settings use-case.

---

## Verification evidence (commands run)

| Gate                | Command                 | Result                                                                                      |
| ------------------- | ----------------------- | ------------------------------------------------------------------------------------------- |
| Type-check          | `npm run typecheck`     | **clean**                                                                                   |
| Lint (+ boundaries) | `npm run lint`          | **0 errors**                                                                                |
| Format              | `npm run format:check`  | **conforms**                                                                                |
| Tests               | `npm run test:coverage` | **154 passed**; stmts **92.9%** · branch **90.1%** · funcs **87.5%**                        |
| Seed                | `npm run db:seed`       | idempotent; `config.read` added                                                             |
| End-to-end demo     | `npm run demo:config`   | ✓ create valid · ✓ **invalid rejected on save** · ✓ set-default · ✓ guarded delete · ✓ list |

---

## What was built

- **Extended grading ports** (`domain/repositories/grading.ts`): `GradeScaleConfigRepository`
  / `AssessmentConfigRepository` gained `list`/`create`/`update`/`softDelete`/
  `setDefault` (+ `findById` for assessment).
- **`ManageGradeScales`** use-cases: `CreateGradeScale`, `UpdateGradeScale`,
  `DeleteGradeScale`, `SetDefaultGradeScale`, `ListGradeScales`.
- **`ManageAssessmentConfigs`** use-cases: the mirror set.
- **Write-side validation (AD8.1):** every create/update routes bands/components
  through `GradeScale.create` / `AssessmentStructure.create` before persisting —
  an inconsistent scale (gap/overlap) or components ≠100 is **rejected on save**.
  Combined with the Phase 4 read loader, invalid config can enter the DB from
  neither direction (closes the write half of F-6).
- **Single default per type (AD8.2):** `setDefault` clears the flag on others
  (atomic via `$transaction` in the Prisma impl); **guarded delete (AD8.4):** the
  active default can't be deleted.
- **Infra:** extended `PrismaGradeScaleRepository` / `PrismaAssessmentConfigRepository`
  with the write methods (dev-only, ADR-007).
- **Seed:** `config.read` permission (+ to REGISTRAR); `config.manage` already
  seeded. `scripts/demo-config.ts` (`npm run demo:config`).
- **Tests** (`tests/config/manage-grade-scales.test.ts`,
  `manage-assessment-configs.test.ts`, `grading-fakes.ts`): valid create + audit,
  **invalid rejected**, duplicate-name, single-default, guarded-delete, authz.

> Note: extending the grading ports required adding stub write methods to the
> Phase 4 `GradingConfigService` test fakes (the loader only uses the read
> methods) — done, suites green.

---

## Decisions honoured

- **Write-side validation** through the value objects (AD8.1) — the headline.
- **Single default + guarded delete** (AD8.2/AD8.4).
- Standing bands **reused** via the Phase 3/4 settings use-case (not rebuilt).
- No schema changes; no UI; no Tauri-SQL persistence (dev Prisma only).

---

## Definition of Done (CLAUDE.md)

- [x] Grade-scale + assessment-structure CRUD, default selection, guarded delete;
      write-side validation enforced.
- [x] `demo:config` runs create/reject/set-default/list end-to-end.
- [x] Tests pass (154); coverage ≥80% (92.9%); `tsc` strict clean; lint/format clean.
- [x] Boundaries intact (fitness test green).
- [x] `/docs` updated; summary posted; approval requested before Phase 9.

_Next: Phase 9 — Results & Processing (result entry, atomic `ProcessSemesterResults`
already built in Phase 7, locking, grade provenance) — the heart of the academic
workflow._
