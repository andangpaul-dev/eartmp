# Phase 11 — Implementation Notes & Verification

**Status:** Implemented. All gates green. **Awaiting approval to start Phase 12.**

Approved: academic summary (per-semester GPA + CGPA + standing), read-only;
faithful aggregation of stored grade points; CGPA by aggregate + standing from the
configured bands; unprocessed results excluded.

---

## Verification evidence (commands run)

| Gate                | Command                 | Result                                                                                  |
| ------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| Type-check          | `npm run typecheck`     | **clean**                                                                               |
| Lint (+ boundaries) | `npm run lint`          | **0 errors**                                                                            |
| Format              | `npm run format:check`  | **conforms**                                                                            |
| Tests               | `npm run test:coverage` | **181 passed**; stmts **93.6%** · branch **89.7%** · funcs **87.8%**                    |
| End-to-end demo     | `npm run demo:summary`  | Sem1 GPA 3.6 · Sem2 GPA 1.5 · **CGPA (aggregate) 2.67** · Standing "Second Class Lower" |

---

## What was built

- **`AcademicSummary`** domain service (`src/domain/services/`, pure):
  `summarizeSemester` (credit-weighted GPA) and `summarizeCumulative`
  (**CGPA = Σ quality points / Σ credits**, never a mean of GPAs — ADR-004).
  No I/O; fully unit-testable.
- **`GetAcademicSummary`** use-case (`application/use-cases/results/`,
  `results.read`): loads a student's processed results, resolves credit values,
  groups by semester, computes the summary, and resolves the **standing** from the
  configured `grading.standingBands` setting via `GpaEngine.resolveStanding`.
- **Faithful aggregation (AD11.1):** sums the **stored** grade points; it does not
  re-grade from raw scores, so a later scale change can't rewrite history.
  Unprocessed results (no `gradePoint`) are excluded; a missing course is a
  data-integrity error.
- `scripts/demo-summary.ts` (`npm run demo:summary`).
- **Tests:** `tests/results/academic-summary.test.ts` (incl. the explicit
  **aggregate-not-mean** CGPA assertion) + `tests/results/get-academic-summary.test.ts`
  (grouping, exclusion, standing, missing-course error, empty summary).

---

## Decisions honoured

- **CGPA by aggregate (ADR-004 / AD11.2)** — pinned by a test asserting `3.4`, not
  the mean `2.5`, for uneven credit loads.
- **Faithful to provenance (AD11.1)** — aggregates stored grade points.
- **Standing is configuration (AD11.3)** — from `standingBands`.
- **Pure domain + thin use-case (AD11.5)**; no schema changes; no new permissions;
  no UI; no Tauri-SQL.

---

## Definition of Done (CLAUDE.md)

- [x] Pure `AcademicSummary` + `GetAcademicSummary` built, gated.
- [x] CGPA by aggregate; standing from configured bands; faithful to provenance.
- [x] `demo:summary` shows per-semester GPA + CGPA + standing across 2 semesters.
- [x] Tests pass (181); coverage ≥80% (93.6%); `tsc` strict clean; lint/format clean.
- [x] Boundaries intact (fitness test green).
- [x] `/docs` updated; summary posted; approval requested before Phase 12.

_Next: Phase 12 — Transcript Engine (template binder: layout JSON + ReportData →
resolved doc; snapshot + signed verification; transcript numbering), consuming
this academic summary._
