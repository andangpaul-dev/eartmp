# Phase 11 — GPA/CGPA & Academic Standing

**Project:** EARTMP · **Phase:** 11 · **Status:** Plan drafted, awaiting approval
to implement · **Predecessor:** Phase 10 (implemented)

> Deliverables-before-implementation spec, in the mandated format. Nothing is
> built until you approve. Same proof model: headless domain/application logic,
> ≥80% coverage, dev adapters, runnable demo; UI deferred to the shell phase.

---

## Executive Summary

Phase 11 turns a student's **processed results** into an **academic summary**:
per-semester GPA, **cumulative CGPA** (by aggregate quality points / credits — not
a mean of GPAs, ADR-004), total credits earned, and a **configured academic
standing** classification. It is **read-only** and **faithful**: it aggregates the
grade points **as they were processed** (it does not re-grade from raw scores with
the current scale), so the summary respects the provenance recorded in Phase 9.
This summary is exactly what the transcript (Phase 12) and graduation eligibility
(Phase 16) consume.

---

## Scope & sequencing

| Concern                                  | Phase 11          | Deferred to |
| ---------------------------------------- | ----------------- | ----------- |
| Per-semester GPA from processed results  | ✅ built + tested | —           |
| Cumulative CGPA (aggregate)              | ✅                | —           |
| Configured academic standing on the CGPA | ✅                | —           |
| Academic summary read use-case           | ✅                | —           |
| Transcript rendering                     | ⛔                | Phase 12    |
| Graduation eligibility                   | ⛔                | Phase 16    |
| UI / Tauri-SQL persistence               | ⛔                | Shell phase |

---

## Objectives

1. A pure domain **`AcademicSummary`** service that aggregates processed course
   grade points into per-semester summaries and a cumulative summary
   (credits attempted/earned, quality points, GPA/CGPA — aggregate, rounded 2dp).
2. A **`GetAcademicSummary`** read use-case: load a student's processed results,
   resolve credit values, group by semester, compute the summary, and resolve the
   **standing** from the configured `standingBands` setting on the CGPA.
3. Faithful to provenance — aggregate **stored** grade points, never re-grade.

**Out of scope:** transcripts (P12), graduation (P16), UI, Tauri-SQL.

---

## Deliverables

| #   | Deliverable                                                                                                                                                 | Layer         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| D1  | `AcademicSummary` domain service (pure): `summarizeSemester`, `summarizeCumulative` over `{ creditValue, gradePoint, creditsEarned }[]`                     | domain        |
| D2  | `GetAcademicSummary` use-case (`results.read`): results → credits → per-semester + CGPA + standing                                                          | application   |
| D3  | Reuse existing ports (`ResultRepository.findByStudent`, `CourseRepository.findById`, `GradingConfigService.loadStandingBands`, `GpaEngine.resolveStanding`) | application   |
| D4  | `scripts/demo-summary.ts` — a student across 2 semesters → per-semester GPA + CGPA + standing                                                               | scripts (dev) |
| D5  | Tests (≥80% coverage) — incl. the **aggregate-not-mean** CGPA property and standing boundaries                                                              | tests         |
| D6  | `/docs` update + implementation notes                                                                                                                       | docs          |

---

## Architecture Decisions

- **AD11.1 — Faithful aggregation, not re-grading.** The summary sums the
  **stored** `gradePoint × creditValue` (quality points) and credits — it does not
  recompute grades from `finalScore` with the current scale. So a later scale
  change doesn't retroactively alter a student's history; the summary matches what
  was processed (provenance, F-19).
- **AD11.2 — CGPA by aggregate (ADR-004).** `CGPA = Σ qualityPoints / Σ
creditsAttempted` across all semesters — correct under uneven credit loads;
  never a mean of semester GPAs. Encoded + tested.
- **AD11.3 — Standing is configuration.** Resolved from the `grading.standingBands`
  setting (Phase 4) via `GpaEngine.resolveStanding(cgpa, bands)` — institution
  policy, not code.
- **AD11.4 — Only processed results count.** Results without a `gradePoint`
  (entered but not yet processed) are excluded from the summary (or surfaced
  separately); credits attempted reflect graded courses.
- **AD11.5 — Pure domain + thin use-case.** The arithmetic lives in the pure
  `AcademicSummary` service (no I/O, fully unit-testable); the use-case only
  gathers data and resolves standing.

---

## Database Changes

- **None.** Read-only over existing `Result` (processed) + `Course` (credit
  values) + the `standingBands` setting. No new permissions (`results.read`).

---

## UI Screens

**None in Phase 11.** Future consumer (deferred): a student academic-summary /
transcript-preview screen.

---

## Services / Use-cases (contracts, abridged)

- `summarizeSemester(semesterId, items): SemesterSummary`
- `summarizeCumulative(semesters): { creditsAttempted, creditsEarned, totalQualityPoints, cgpa }`
- `GetAcademicSummary.execute({ studentId }, session): Promise<AcademicSummary>` → `results.read`
  - `AcademicSummary = { semesters: SemesterSummary[]; creditsAttempted; creditsEarned; totalQualityPoints; cgpa; standing }`

---

## Validation Rules

- Only results with a resolved `gradePoint` (processed) are aggregated.
- `creditValue` resolved from the live course; a missing course is an error
  (data integrity), not silently skipped.
- GPA/CGPA rounded to 2dp; zero-credit guards return 0 (no divide-by-zero).
- Authorized (`results.read`, fail-closed).

---

## Test Plan

| Test                    | Asserts                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| summarizeSemester       | credit-weighted GPA; zero-credit → 0                                                       |
| **summarizeCumulative** | **CGPA by aggregate, not mean** (uneven credit loads) — the ADR-004 property               |
| GetAcademicSummary      | groups by semester; resolves credits; excludes unprocessed; standing from configured bands |
| standing boundaries     | classification at band edges (First/Second/Pass/Fail)                                      |
| missing course          | surfaced as an error                                                                       |
| coverage                | ≥80% on new code                                                                           |

All headless against in-memory fakes; the domain service is pure.

---

## Risks

| ID    | Risk                                             | Mitigation                                                                    |
| ----- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| P11-a | Re-grading vs faithful aggregation confusion     | AD11.1 — aggregate stored grade points; a test pins the behaviour             |
| P11-b | CGPA computed as a mean (classic bug)            | AD11.2 + an explicit aggregate-not-mean test                                  |
| P11-c | Standing differs per institution                 | bands are a setting (AD11.3)                                                  |
| P11-d | Mixed grade scales across semesters (provenance) | faithful aggregation uses stored points, so mixed-scale history is consistent |

---

## Completion Criteria

- [ ] Pure `AcademicSummary` service + `GetAcademicSummary` use-case built, gated.
- [ ] CGPA by aggregate (ADR-004); standing from configured bands; faithful to provenance.
- [ ] `demo:summary` shows per-semester GPA + CGPA + standing for a multi-semester student.
- [ ] Tests pass; coverage ≥80% on new code; `tsc` strict clean; lint/format clean.
- [ ] Boundaries intact (fitness test green).
- [ ] `/docs` updated; summary posted; **approval requested before Phase 12.**

---

## Approval Checklist (to start Phase 11 implementation)

- [ ] Scope confirmed: academic summary (per-semester GPA + CGPA + standing), read-only.
- [ ] **Faithful aggregation** of stored grade points (not re-grading) — OK?
- [ ] **CGPA by aggregate** (ADR-004) + standing from the configured bands — OK?
- [ ] Unprocessed results excluded from the summary — OK?
- [ ] Go-ahead to implement.

_Related: [architecture-review.md](../phase-0/architecture-review.md) (F-8, ADR-004) ·
`src/domain/services/GpaEngine.ts` · [phase-9 implementation notes](../phase-9/implementation-notes.md) (provenance)_
