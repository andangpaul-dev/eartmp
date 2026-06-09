# Phase 4 — Implementation Notes & Verification

**Status:** Implemented. All gates green. **Awaiting approval to start Phase 5.**

Scope approved: adopt engines + add the validated config loader + configurable
standing (placeholder classification bands).

---

## Verification evidence (commands run)

| Gate                | Command                 | Result                                                                                                                               |
| ------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Type-check          | `npm run typecheck`     | **clean**                                                                                                                            |
| Lint (+ boundaries) | `npm run lint`          | **0 errors**                                                                                                                         |
| Format              | `npm run format:check`  | **conforms**                                                                                                                         |
| Tests               | `npm run test:coverage` | **112 passed**; stmts **98.1%** · branch **94.7%** · funcs **97.6%**                                                                 |
| Seed                | `npm run db:seed`       | idempotent; standing-bands setting added                                                                                             |
| End-to-end demo     | `npm run demo:grading`  | ✓ loads validated config from DB · ✓ computes final from components · ✓ grades semester (GPA 3.11) · ✓ standing "Second Class Upper" |

---

## What was built

- **Engine adoption review** ([engine-adoption-review.md](engine-adoption-review.md))
  — `GradeScale`, `AssessmentStructure`, `GpaEngine` reviewed against the design +
  ADRs and **adopted as-is** (no changes). They stay pure.
- **`GradingConfigService`** (`src/application/services/`) — the **single
  validated gateway** to stored grading config (closes **F-6**): the only place
  that parses `GradeScale.bands` / `AssessmentConfig.components` JSON and the
  standing setting, routing every load through `GradeScale.create` /
  `AssessmentStructure.create`. Invalid stored config (gap/overlap, weights≠100,
  corrupt JSON) **fails loudly** with a typed error.
- **`grading.standingBands` setting** — academic standing as configuration
  (AD4.3), validated through the registry; default classification bands seeded.
- **Read ports** (`src/domain/repositories/grading.ts`) + **dev Prisma adapters**
  (`PrismaGradingRepositories.ts`, ADR-007 — replaced by Tauri-SQL in Phase 7).
- `scripts/demo-grading.ts` (`npm run demo:grading`).

**Tests** (`tests/grading/`): the loader (default/by-id/by-name resolution,
fail-loud on invalid/corrupt config), assessment loading, and standing bands
(default + stored) classifying GPAs — plus the standing-setting validator
branches. Engines retain 100% coverage from their existing suites.

---

## Decisions honoured

- **F-6 closed:** one validated choke point for grading config; no use-case reads
  the JSON columns directly (AD4.2).
- **Engines pure** (AD4.1) — no DB/UI; the loader (application) does the I/O.
- **Standing = configuration** (AD4.3).
- **F-19 (provenance) deferred** to Phase 9 + the pre-Phase-5 schema bundle; the
  loader resolves a scale by id/name so it's wireable then (AD4.4).
- No schema changes; no UI; no Tauri-SQL persistence (dev Prisma only).

---

## Definition of Done (CLAUDE.md)

- [x] Engines reviewed + adopted; engine tests green.
- [x] `GradingConfigService` loads + validates grade scale / assessment / standing
      at one choke point.
- [x] `demo:grading` loads the default scale from `dev.db` and prints GPA + standing.
- [x] Tests pass (112); coverage ≥80% (98.1%); `tsc` strict clean; lint/format clean.
- [x] Boundaries intact (engines pure; fitness test green).
- [x] `/docs` updated; summary posted; approval requested before Phase 5.

_Next: Phase 5 — Academic Structure (faculty → department → programme → level,
sessions/semesters) — preceded by the **pre-Phase-5 schema-revision bundle**
(ADR-010: provenance, enrollment history, course offering, version column, FK
indexes, CHECK constraints, partial-unique indexes)._
