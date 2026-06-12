# Phase 16 — Graduation & Eligibility

**Project:** EARTMP · **Phase:** 16 · **Status:** Plan drafted, awaiting approval
to implement · **Predecessor:** Phase 15 (implemented)

> Deliverables-before-implementation spec, in the mandated format. Nothing is
> built until you approve. Logic only; UI deferred to the shell phase. Same proof
> model: headless, ≥80% coverage, dev Prisma adapter, runnable demo.

---

## Executive Summary

Phase 16 decides **who can graduate**. It evaluates a student's **academic summary**
(Phase 11) against **configurable graduation requirements** — minimum CGPA,
minimum credits earned, and no outstanding fails — and returns a transparent
**eligibility report** (each criterion: required vs actual vs met). An audited
**clearance** use-case then moves an _eligible_ student to **GRADUATED** (via the
Phase 6 status-transition guard). Requirements are **runtime-configured** (a
validated setting), never hardcoded (BSD §2).

---

## Scope & sequencing

| Concern                                                | Phase 16          | Deferred to      |
| ------------------------------------------------------ | ----------------- | ---------------- |
| Configurable graduation requirements (setting)         | ✅                | —                |
| Pure `evaluateGraduation(summary, reqs)` → report      | ✅ built + tested | —                |
| `EvaluateGraduation` use-case (read)                   | ✅                | —                |
| `GraduateStudent` clearance (→ GRADUATED, audited)     | ✅                | —                |
| Required-specific-course rules (must-pass course list) | ⛔ (deferred)     | later refinement |
| Batch cohort clearance / convocation lists             | ⛔                | Shell / later    |
| UI                                                     | ⛔                | Shell phase      |

---

## Objectives

1. A **`GraduationRequirements`** config (setting `graduation.requirements`,
   validated JSON): `minCgpa`, `minCreditsEarned`, `requireNoOutstandingFails`.
2. A **pure** `evaluateGraduation(summary, requirements): EligibilityReport` —
   one criterion per rule (`{ name, required, actual, met }`); `eligible` = all met.
3. **`EvaluateGraduation`** use-case (`graduation.read`) — loads the academic
   summary + requirements, runs the pure evaluator, returns the report.
4. **`GraduateStudent`** use-case (`graduation.clear`) — re-checks eligibility,
   then transitions the student to **GRADUATED** (Phase 6 `canTransition` guard),
   audited. Refuses if ineligible or the transition isn't allowed.

**Out of scope:** required-specific-course rules, batch clearance, UI.

---

## Deliverables

| #   | Deliverable                                                                                                                    | Layer             |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| D1  | `GraduationRequirements` + `EligibilityReport`/`Criterion` types; pure `evaluateGraduation`                                    | domain            |
| D2  | `graduation.requirements` setting in the registry (typed validator, sensible defaults)                                         | domain (settings) |
| D3  | `EvaluateGraduation` use-case (`graduation.read`) over the academic summary + requirements                                     | application       |
| D4  | `GraduateStudent` use-case (`graduation.clear`) — eligibility-gated status transition → GRADUATED, audited                     | application       |
| D5  | Seed: `graduation.read` + `graduation.clear` permissions; the `graduation.requirements` setting                                | seed              |
| D6  | `scripts/demo-graduation.ts` — eligible vs ineligible report + a clearance (status → GRADUATED)                                | scripts (dev)     |
| D7  | Tests (≥80%) — evaluator matrix (each rule pass/fail), eligible/ineligible reports, clearance gating + transition guard, authz | tests             |
| D8  | `/docs` update + implementation notes                                                                                          | docs              |

---

## Architecture Decisions

- **AD16.1 — Requirements are configuration (BSD §2).** Stored in the
  `graduation.requirements` setting (validated envelope, Phase 2 registry), so an
  institution tunes its own bar without code changes.
- **AD16.2 — Pure evaluator over the academic summary.** `evaluateGraduation`
  takes the Phase 11 `AcademicSummary` aggregate (cgpa, creditsEarned,
  creditsAttempted) — no I/O, fully unit-testable; the use-case only gathers data.
- **AD16.3 — "No outstanding fails" from the aggregate.** Reuses the summary's
  `creditsAttempted === creditsEarned` signal (passed credits == attempted), so no
  per-course re-derivation is needed for v1. (Required-specific-course rules — a
  must-pass list — are a later refinement when per-course detail is surfaced.)
- **AD16.4 — Clearance is eligibility-gated + transition-guarded.**
  `GraduateStudent` re-evaluates (never trusts a stale report), then uses the Phase
  6 `canTransition` matrix (ACTIVE → GRADUATED) before writing; audited
  (separation: `graduation.clear` ≠ `graduation.read`).
- **AD16.5 — Transparent report.** Every criterion reports required vs actual vs
  met, so a rejection always explains itself (no opaque "not eligible").

---

## Database Changes

- **None to the schema shape** — `Student.status` already supports `GRADUATED`
  (Phase 6) with the `ACTIVE → GRADUATED` transition. Uses the existing student +
  results data and the settings table.
- **Seed:** `graduation.read` + `graduation.clear` permissions; the
  `graduation.requirements` default setting.

---

## UI Screens

**None in Phase 16.** Future consumer (deferred): an eligibility dashboard / cohort
clearance list.

---

## Services / Use-cases (contracts, abridged)

- `evaluateGraduation(summary, requirements): EligibilityReport`
  - `EligibilityReport = { eligible: boolean; criteria: { name; required; actual; met }[] }`
- `EvaluateGraduation.execute({ studentId }, session): EligibilityReport` → `graduation.read`
- `GraduateStudent.execute({ studentId }, session): { status }` → `graduation.clear`

---

## Validation Rules

- `evaluateGraduation`: `cgpa ≥ minCgpa`; `creditsEarned ≥ minCreditsEarned`; if
  `requireNoOutstandingFails`, `creditsAttempted === creditsEarned`.
- `GraduateStudent`: student exists + is `ACTIVE`; eligible; `canTransition(ACTIVE,
GRADUATED)`; else a clear error. Authorized (fail-closed) + audited.
- `graduation.requirements` setting validated (non-negative numbers, cgpa in range).

---

## Test Plan

| Test                  | Asserts                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| evaluator             | each rule met/unmet flips `met`; `eligible` = all met; report lists required/actual                                    |
| eligible / ineligible | a passing student → eligible; a low-CGPA / missing-credits / has-fails student → not, with the failing criterion named |
| clearance happy path  | eligible ACTIVE student → status GRADUATED, audited                                                                    |
| clearance gating      | ineligible → rejected; non-ACTIVE → rejected (transition guard)                                                        |
| authz                 | evaluate gated by `graduation.read`; clearance by `graduation.clear`                                                   |
| settings              | requirements setting validates; bad values rejected                                                                    |
| coverage              | ≥80% on new code                                                                                                       |

---

## Risks

| ID    | Risk                                                | Mitigation                                                                           |
| ----- | --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| P16-a | "No outstanding fails" via aggregate is approximate | documented (AD16.3); exact per-course / must-pass list is a flagged later refinement |
| P16-b | Stale eligibility used for clearance                | `GraduateStudent` re-evaluates at clearance time (AD16.4)                            |
| P16-c | Requirements vary widely by institution             | fully config-driven (AD16.1)                                                         |
| P16-d | Re-graduating / reversing                           | GRADUATED is terminal (Phase 6); reversal is an explicit future workflow, not silent |

---

## Completion Criteria

- [ ] Configurable requirements + pure evaluator + `EvaluateGraduation` +
      eligibility-gated `GraduateStudent` built, gated, audited.
- [ ] `demo:graduation` shows an eligible report, an ineligible report (named
      reason), and a clearance to GRADUATED.
- [ ] Tests pass; coverage ≥80% on new code; `tsc` strict clean; lint/format clean.
- [ ] Boundaries intact (evaluator pure; fitness test green).
- [ ] `/docs` updated; summary posted; **approval requested before Phase 17.**

---

## Approval Checklist (to start Phase 16 implementation)

- [ ] Scope confirmed: configurable rules + eligibility report + clearance, logic only.
- [ ] Requirements stored as a validated **`graduation.requirements` setting** — OK?
- [ ] v1 criteria: **min CGPA + min credits earned + no outstanding fails** (must-pass course list deferred) — OK?
- [ ] **`GraduateStudent`** clearance moves an eligible student to GRADUATED (audited) — include now?
- [ ] New `graduation.read` + `graduation.clear` permissions — OK?
- [ ] Go-ahead to implement.

_Related: [phase-11 implementation notes](../phase-11/implementation-notes.md) (academic summary) ·
`src/domain/entities/student-status.ts` (transition matrix) ·
[phase-8 implementation notes](../phase-8/implementation-notes.md) (settings-as-config pattern)_
