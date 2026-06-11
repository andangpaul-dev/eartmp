# Phase 9 — Results & Processing

**Project:** EARTMP · **Phase:** 9 · **Status:** Plan drafted, awaiting approval
to implement · **Predecessor:** Phase 8 (implemented)

> Deliverables-before-implementation spec, in the mandated format. Nothing is
> built until you approve. Same proof model: headless domain/application logic,
> ≥80% coverage, dev Prisma adapters, runnable demo; UI + Tauri-SQL persistence
> deferred to the shell phase.

---

## Executive Summary

Phase 9 is the **core records pipeline**. An operator enters **component scores**
for a student's course in a semester; the configured **assessment structure**
computes the **final score**; **processing** a semester turns those into grades,
grade points, credits earned and a **GPA** — **atomically** (Phase 7's UnitOfWork)
and with **grade-scale provenance** recorded on each result (F-19). Processed
results are then **locked** (`Result.isLocked`), immutable except through an
explicit, **audited unlock** workflow (separation of duties: `results.unlock`).

It builds directly on what's already in place: the engines (Phase 4), the
validated config loader (Phase 4/8), and the **atomic `ProcessSemesterResults`**
(Phase 7). Phase 9 fills in **result entry**, **locking**, the **read** side, and
the **canonical Result repository** (paying down the last reconciliation note).

---

## Scope & sequencing

| Concern                                     | Phase 9                          | Deferred to |
| ------------------------------------------- | -------------------------------- | ----------- |
| Enter/update component scores → final score | ✅ built + tested                | —           |
| Process a semester (atomic, provenance)     | ✅ wired (engine + loader + UoW) | —           |
| Lock results + audited unlock               | ✅ built + tested                | —           |
| Read results (per student / semester)       | ✅                               | —           |
| Canonical `ResultRepository` (full)         | ✅ reconciled                    | —           |
| Bulk spreadsheet import                     | ⛔                               | Phase 10    |
| CGPA across sessions / standing views       | ⛔                               | Phase 11    |
| Transcript generation                       | ⛔                               | Phase 12    |
| UI / Tauri-SQL persistence                  | ⛔                               | Shell phase |

---

## Objectives

1. **Enter results:** record/replace a student's component scores for a course in
   a semester; compute the **final score** via the configured
   `AssessmentStructure` (loaded through `GradingConfigService`); dedupe on
   `(student, course, semester)`; **reject writes to a locked result**.
2. **Process a semester:** an authorized use-case that loads the default (or
   chosen) `GradeScale`, runs the atomic `ProcessSemesterResults`, and stamps
   `gradeScaleId` provenance (F-19).
3. **Lock / unlock:** lock a student's processed semester results
   (`results.process`); unlock an individual result via an **audited** workflow
   (`results.unlock`) — locked results are otherwise immutable.
4. **Read:** fetch a student's results for a semester / their full history.
5. **Reconcile** the `ResultRepository` to one canonical full port (extends the
   Phase 7 stub) and update the reference use-case + its fake.

**Out of scope:** import (P10), CGPA/standing aggregation (P11), transcripts
(P12), UI, Tauri-SQL.

---

## Deliverables

| #   | Deliverable                                                                                                                                                                                               | Layer         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| D1  | Extend `ResultRepository` (records.ts): `create`, `findById`, `existsFor`, `updateScores`, `setLockedForSemester`, `unlock`, `findByStudent` (+ the Phase 7 `findByStudentAndSemester`/`updateProcessed`) | domain        |
| D2  | `EnterResult` use-case (compute final score via assessment structure; dedupe; reject if locked; audited)                                                                                                  | application   |
| D3  | `ProcessSemester` use-case (loads scale via `GradingConfigService`, runs atomic `ProcessSemesterResults`, records provenance)                                                                             | application   |
| D4  | `LockSemesterResults` (`results.process`) + `UnlockResult` (`results.unlock`) — audited                                                                                                                   | application   |
| D5  | `GetStudentSemesterResults` / `GetStudentResults` reads (`results.read`)                                                                                                                                  | application   |
| D6  | Dev-only `PrismaResultRepository` extended to the full port                                                                                                                                               | infra (dev)   |
| D7  | Seed: `results.read` permission (results.import/process/unlock already seeded)                                                                                                                            | seed          |
| D8  | `scripts/demo-results.ts` — enter scores, process (GPA + provenance), lock, blocked edit, unlock                                                                                                          | scripts (dev) |
| D9  | Tests (≥80% coverage on new domain+application code)                                                                                                                                                      | tests         |
| D10 | `/docs` update + implementation notes                                                                                                                                                                     | docs          |

---

## Architecture Decisions

- **AD9.1 — Final score is computed by the configured assessment structure.**
  `EnterResult` loads the default `AssessmentStructure` (via `GradingConfigService`)
  and calls `computeFinalScore(componentScores)`; raw scores + the computed final
  score are stored. (Per-programme/per-course structures are a later refinement;
  v1 uses the default.)
- **AD9.2 — Processing is atomic + provenance-stamped.** `ProcessSemester` runs
  inside the UnitOfWork (Phase 7, fixes F-1) and writes `gradeScaleId` on every
  result (F-19), so a historical grade is always reproducible.
- **AD9.3 — Lock is the integrity gate.** A locked result rejects component-score
  edits and re-processing; only an audited `UnlockResult` (separate permission)
  reopens it (separation of duties, security architecture §4).
- **AD9.4 — Dedupe at the use-case + DB.** `(student, course, semester)` is unique
  (Phase 1); `EnterResult` checks `existsFor` and updates rather than duplicating.
- **AD9.5 — Canonical Result port.** The Phase 7 stub grows into the full port;
  the reference `ProcessSemesterResults` + its fake are updated in the same change
  (last piece of the Phase 7 reconciliation).

---

## Database Changes

- **None to the schema shape** — `Result` exists (Phase 1) with `componentScores`
  (JSON), `finalScore`, `grade`, `gradePoint`, `creditsEarned`, `isLocked`,
  `gradeScaleId`/`assessmentConfigId` (Phase 5 provenance), `version` (Phase 5),
  unique `(studentId, courseId, semesterId)`.
- **Seed addition:** `results.read` permission (granted to SUPER_ADMIN/REGISTRAR/
  DATA_ENTRY); the other `results.*` already seeded.

---

## UI Screens

**None in Phase 9.** Future consumers (deferred): result-entry grid,
process-semester action, lock/unlock controls, results viewer.

---

## Services / Use-cases (contracts, abridged)

- `EnterResult.execute({ studentId, courseId, semesterId, componentScores }, session)` → `results.process`; computes final score; rejects if locked; audits.
- `ProcessSemester.execute({ studentId, semesterId, gradeScaleRef? }, session)` → `results.process`; atomic; returns the GPA summary; provenance recorded.
- `LockSemesterResults.execute({ studentId, semesterId }, session)` → `results.process`.
- `UnlockResult.execute({ resultId }, session)` → `results.unlock`; audited UNLOCK.
- `GetStudentSemesterResults.execute({ studentId, semesterId }, session)` → `results.read`.

---

## Validation Rules

- Component score keys/values valid per the assessment structure (the value object
  enforces range + completeness); final score 0–100.
- No duplicate `(student, course, semester)` live result (AD9.4).
- Writes to a locked result are rejected; unlock requires `results.unlock`.
- All writes authorized (fail-closed) + audited; processing records provenance.

---

## Test Plan

| Test            | Asserts                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| EnterResult     | computes final score from components; dedupes (update not duplicate); **rejects when locked**; authz/audit |
| ProcessSemester | atomic grade/GPA write; `gradeScaleId` provenance stamped; uses the loaded scale                           |
| atomic rollback | a failure mid-process leaves zero results updated (re-uses Phase 7 UoW)                                    |
| Lock/Unlock     | lock blocks edits + re-process; unlock (gated `results.unlock`) reopens + audits                           |
| reads           | per-semester / full-history results returned                                                               |
| coverage        | ≥80% on new code                                                                                           |

Unit tests headless against in-memory fakes; the Phase 7 integration suite covers
the real-DB atomicity.

---

## Risks

| ID   | Risk                                                           | Mitigation                                                                                         |
| ---- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| P9-a | Per-course assessment structures needed sooner than v1 default | default now (AD9.1); the loader already resolves by name, so per-course is an additive enhancement |
| P9-b | Locked-result bypass                                           | the lock check lives in the use-cases; `results.unlock` is a distinct permission (AD9.3)           |
| P9-c | Result port reconciliation breaks the reference use-case       | done behind green tests; fake updated in the same change (AD9.5)                                   |
| P9-d | Provenance not stamped on re-process                           | `ProcessSemester` always passes `gradeScaleId` (AD9.2)                                             |

---

## Completion Criteria

- [ ] Enter / process / lock / unlock / read use-cases built, gated, audited.
- [ ] Processing is atomic and stamps grade-scale provenance (F-19); locked
      results are immutable except via audited unlock.
- [ ] `ResultRepository` reconciled to one full canonical port.
- [ ] `demo:results` runs enter → process → lock → blocked-edit → unlock.
- [ ] Tests pass; coverage ≥80% on new code; `tsc` strict clean; lint/format clean.
- [ ] Boundaries intact (fitness test green).
- [ ] `/docs` updated; summary posted; **approval requested before Phase 10.**

---

## Approval Checklist (to start Phase 9 implementation)

- [ ] Scope confirmed: entry + processing + lock/unlock + reads, logic only.
- [ ] **Permissions:** reuse `results.process` for entry/process/lock, `results.unlock`
      for unlock, add `results.read` for reads — OK?
- [ ] **Locking granularity:** lock per student+semester; unlock per result — OK?
- [ ] **Assessment structure:** use the **default** for v1 (per-course later) — OK?
- [ ] Reconcile the `ResultRepository` to one full port now — OK.
- [ ] Go-ahead to implement.

_Related: [architecture-review.md](../phase-0/architecture-review.md) (F-1, F-19, F-3) ·
[phase-7 implementation notes](../phase-7/implementation-notes.md) (atomic ProcessSemesterResults) ·
`src/application/services/GradingConfigService.ts`_
