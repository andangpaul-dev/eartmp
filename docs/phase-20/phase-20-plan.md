# Phase 20 — Final Integration & Release Readiness

**Project:** EARTMP · **Phase:** 20 (final) · **Status:** Plan drafted, awaiting
approval to implement · **Predecessor:** Phase 19 (implemented)

> Deliverables-before-implementation spec, in the mandated format. Nothing is
> built until you approve. **No new application features** — this phase proves the
> existing phases compose, finalizes operator docs, and confirms release
> readiness. The Tauri + React shell remains a separate, deferred effort.

---

## Executive Summary

Phases 0–19 built the records → transcript → graduation → backup → audit pipeline,
each verified in isolation. Phase 20 proves it **composes**: a single end-to-end
flow that admits a student, enters and processes results, computes GPA/CGPA,
generates and signs a transcript, exports a PDF, evaluates and clears graduation,
backs up, and verifies the audit chain — exercised both **headlessly (integration
test, in the suite)** and as a **runnable `demo:e2e`** against the dev adapters. It
then finalizes the **operator runbook** and a **release checklist**, and records
the 20-phase BSD as **complete**.

---

## Scope & sequencing

| Concern                                                      | Phase 20  | Deferred to |
| ------------------------------------------------------------ | --------- | ----------- |
| Headless end-to-end integration test (fakes)                 | ✅ built  | —           |
| `demo:e2e` — full pipeline on dev adapters (non-destructive) | ✅        | —           |
| Operator runbook (`docs/runbook.md`)                         | ✅        | —           |
| Release checklist (`docs/release-checklist.md`)              | ✅        | —           |
| BSD completion status + docs index                           | ✅        | —           |
| New application features                                     | ⛔ (none) | —           |
| Tauri + React shell (UI + Tauri-SQL runtime)                 | ⛔        | Shell phase |
| Production deploy / packaging / signing certs                | ⛔        | Shell / ops |

---

## Objectives

1. A **headless integration test** (`tests/integration/pipeline.test.ts`) composing
   the real use-cases over in-memory fakes: admit → enrol → enter results →
   process semester → academic summary → evaluate graduation → graduate, asserting
   the data flows correctly across phase boundaries (no UI, no DB).
2. A **`demo:e2e`** script running the same flow on the **dev Prisma adapters** end
   to end (incl. transcript generation + signing via the sealed key, PDF export,
   backup create/verify, audit-chain verify), with non-destructive cleanup.
3. An **operator runbook** — install/seed, the bootstrap passphrase, running the
   demos, the verification gate, backup/restore, and key-passphrase rotation.
4. A **release checklist** — the green-gate criteria, migrations applied, secrets
   sealed, backup tested, audit chain verifying, coverage threshold, and the
   shell-phase boundary.
5. **BSD completion** — mark phases 0–20 done; a top-level docs index of the phase
   deliverables.

**Out of scope:** new features, UI, packaging.

---

## Deliverables

| #   | Deliverable                                                                                  | Layer         |
| --- | -------------------------------------------------------------------------------------------- | ------------- |
| D1  | `tests/integration/pipeline.test.ts` — admit→…→graduate over fakes (cross-phase composition) | tests         |
| D2  | `scripts/demo-e2e.ts` + `demo:e2e` script — full pipeline on dev adapters, non-destructive   | scripts (dev) |
| D3  | `docs/runbook.md` — operator runbook                                                         | docs          |
| D4  | `docs/release-checklist.md` — release readiness checklist (all gates)                        | docs          |
| D5  | `docs/README.md` — docs index + BSD 20/20 completion status                                  | docs          |
| D6  | Phase 20 implementation notes; CLAUDE.md "Current status" updated to complete                | docs          |
| D7  | Final full-gate run recorded (typecheck/lint/format/tests/coverage + every demo)             | verification  |

---

## Architecture Decisions

- **AD20.1 — Integration test over fakes, demo over adapters.** The suite test
  proves the use-cases compose with zero I/O (fast, deterministic, CI-friendly);
  `demo:e2e` proves the dev Prisma adapters + crypto wire together for real. Two
  altitudes, one flow.
- **AD20.2 — Non-destructive e2e.** `demo:e2e` provisions its own
  faculty/programme/student/courses, runs the pipeline, and deletes only what it
  created — `dev.db` and the seeded config are untouched.
- **AD20.3 — No new features.** Phase 20 adds tests + docs only; any gap surfaced
  is recorded as a known limitation / shell-phase item, not silently patched.
- **AD20.4 — Release gate is the definition of done.** "Release-ready (headless
  core)" = the full gate green + every demo passing + the checklist satisfied; the
  **runnable product** still requires the shell phase (stated plainly).

---

## Database Changes

- **None.** No schema, seed, or permission changes.

---

## UI Screens

**None.** The UI is the shell phase.

---

## Integration flow (what the test + demo exercise)

`AdmitStudent` → `EnrollStudent` → `EnterResult` ×N → `ProcessSemester`
(GPA + provenance) → `GetAcademicSummary` (CGPA + standing) →
`EvaluateGraduation` → `GraduateStudent`. The `demo:e2e` additionally:
`GenerateTranscript` (sealed-key sign) → `VerifyTranscript` → `ExportTranscript`
(PDF) → `CreateBackup`/verify → `VerifyAuditChain`.

---

## Test Plan

| Test                 | Asserts                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| pipeline integration | admit→enrol→enter→process→summary→graduate produces the expected CGPA + GRADUATED status across fakes                        |
| boundary integrity   | the existing `architecture.test.ts` fitness test still passes (no layering violations introduced)                            |
| demo:e2e             | the full real-adapter flow runs green end to end (transcript signs/verifies, PDF `%PDF`, backup verifies, audit chain valid) |
| full gate            | typecheck/lint/format clean; total suite passes; coverage ≥80%                                                               |

---

## Risks

| ID    | Risk                              | Mitigation                                                                           |
| ----- | --------------------------------- | ------------------------------------------------------------------------------------ |
| P20-a | "Done" misread as a shippable app | release checklist states the shell phase is required for a runnable product (AD20.4) |
| P20-b | e2e mutating shared dev.db state  | self-provisioned + scoped cleanup (AD20.2)                                           |
| P20-c | Integration test brittle/slow     | fakes only, no I/O; one focused happy-path flow (AD20.1)                             |
| P20-d | Gaps surfaced at integration      | recorded as known limitations / shell items, not hot-patched (AD20.3)                |

---

## Completion Criteria

- [ ] Headless pipeline integration test passes; `demo:e2e` runs the full flow green.
- [ ] `docs/runbook.md` + `docs/release-checklist.md` + `docs/README.md` (index +
      BSD 20/20) written; CLAUDE.md status updated to **complete**.
- [ ] Full gate green (typecheck/lint/format/tests/coverage); every demo passes.
- [ ] Boundaries intact (fitness test green).
- [ ] `/docs` updated; **final summary posted** (project headless core complete;
      shell phase is the remaining runnable-product work).

---

## Approval Checklist (to start Phase 20 implementation)

- [ ] Scope confirmed: integration test + `demo:e2e` + runbook + release checklist + BSD completion, **no new features**.
- [ ] **Both** a headless integration test (fakes) **and** a `demo:e2e` (dev adapters) — OK? (or just one — say which)
- [ ] Finalize **runbook** + **release checklist** docs + a `docs/README.md` index — OK?
- [ ] Update CLAUDE.md "Current status" to mark the 20-phase BSD complete (headless core) — OK?
- [ ] Go-ahead to implement.

_Related: `tests/architecture.test.ts` (boundary fitness) ·
[build-sequence-document.md](../build-sequence-document.md) (the 20 phases) ·
all `docs/phase-*/implementation-notes.md`_
