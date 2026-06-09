# Phase 4 — Domain Engines

**Project:** EARTMP · **Phase:** 4 · **Status:** Plan drafted, awaiting approval
to implement · **Predecessor:** Phase 3 (implemented)

> Deliverables-before-implementation spec, in the mandated format. Nothing is
> built/changed until you approve. Same proof model as Phases 1–3: headless
> domain/application logic, ≥80% coverage, dev-only Prisma adapter for a runnable
> demo.

---

## Executive Summary

The calculation core — `GradeScale` (validated mark→grade bands),
`AssessmentStructure` (weighted components), and `GpaEngine` (credit-weighted GPA,
aggregate CGPA, configurable standing) — **already exists** at `src/domain` from
the reference implementation and is fully tested (32 engine assertions, 100%
coverage). CLAUDE.md earmarks this as "reference for Phase 4 — review against the
approved design, adapt, re-test; do not paste in wholesale or jump ahead."

Phase 4 therefore does two things:

1. **Formally adopt** the existing engines as approved Phase 4 code after a
   review against the Phase 0 design + ADRs (they pass; the review confirms no
   changes are needed, or makes small ones).
2. **Build the missing piece**: a **single, validated configuration loader**
   (`GradingConfigService`) that turns the stored `GradeScale` / `AssessmentConfig`
   rows and the standing-bands setting into validated domain value objects — the
   one choke point that closes review finding **F-6** ("config validated on read,
   no scattered raw-JSON reads").

This makes grading/assessment/standing genuinely runtime-configured end to end:
DB rows → validated value objects → engines.

---

## Scope & sequencing

| Concern                                                       | Phase 4                | Deferred to                    |
| ------------------------------------------------------------- | ---------------------- | ------------------------------ |
| Adopt/review `GradeScale`, `AssessmentStructure`, `GpaEngine` | ✅                     | —                              |
| `GradingConfigService` (single validated loader, F-6)         | ✅ built + tested      | —                              |
| Configurable **academic standing** bands (as a setting)       | ✅ built + tested      | —                              |
| Read ports for grade-scale / assessment-config rows           | ✅                     | —                              |
| **Grade-scale provenance on `Result`** (F-19)                 | ⛔ (engines stay pure) | Phase 9 + pre-P5 schema bundle |
| Persisting processed results / locking                        | ⛔                     | Phase 9                        |
| Concrete Tauri-SQL persistence                                | ⛔                     | Phase 7                        |

> Engines remain **pure** (no I/O). Provenance — recording _which_ scale produced
> a grade (F-19) — is the job of the processing use-case (Phase 9) writing to a
> `Result.gradeScaleId`, added in the pre-Phase-5 schema bundle (ADR-010). Phase 4
> only ensures the loader can resolve a scale by id/name so provenance is wireable.

---

## Objectives

1. Review the existing engines against the design/ADRs; adopt them as approved
   (with any small adjustments the review surfaces).
2. Add **`GradingConfigService`** — the only gateway that reads grading config:
   - `loadGradeScale(nameOrId?)` → validated `GradeScale` (via `GradeScale.create`)
   - `loadAssessmentStructure(name?)` → validated `AssessmentStructure`
   - `loadStandingBands()` → validated standing bands (from settings)
   - resolves the **default** when no name/id is given.
3. Add **configurable academic standing** as a `grading.standingBands` setting
   (registry entry) and a thin `resolveStanding` path on top of `GpaEngine`.
4. Read ports for the config rows; dev Prisma adapters; a runnable grading demo.

**Out of scope:** writing results, locking, provenance columns, UI, Tauri-SQL.

---

## Deliverables

| #   | Deliverable                                                                                                               | Layer           |
| --- | ------------------------------------------------------------------------------------------------------------------------- | --------------- |
| D1  | Engine adoption review note (engines validated against design/ADRs)                                                       | docs            |
| D2  | `grading.standingBands` setting added to the registry (default classification bands)                                      | domain          |
| D3  | Read ports: `GradeScaleConfigRepository`, `AssessmentConfigRepository` (return raw bands/components + name/id/isDefault)  | domain          |
| D4  | **`GradingConfigService`** — single validated loader (F-6); returns `GradeScale` / `AssessmentStructure` / standing bands | application     |
| D5  | `GradeScaleError` / `AssessmentError` surfaced cleanly when stored config is invalid                                      | domain (exists) |
| D6  | Dev-only `PrismaGradeScaleRepository`, `PrismaAssessmentConfigRepository`                                                 | infra (dev)     |
| D7  | `scripts/demo-grading.ts` — load default scale from DB, grade a sample, show GPA + standing                               | scripts (dev)   |
| D8  | Tests (≥80% coverage on new domain+application code; engines already 100%)                                                | tests           |
| D9  | `/docs` update + implementation notes                                                                                     | docs            |

---

## Architecture Decisions

- **AD4.1 — Engines stay pure (no I/O).** They take validated value objects /
  primitives; they never read the DB. This is the property that keeps the domain
  testable with no database (the architecture proof).
- **AD4.2 — One validated config choke point (closes F-6).** `GradingConfigService`
  is the _only_ place that parses `GradeScale.bands` / `AssessmentConfig.components`
  JSON; it validates through `GradeScale.create` / `AssessmentStructure.create`
  and returns value objects. No use-case reads those JSON columns directly. A
  stored config that is invalid (gap/overlap/weights≠100) fails loudly on load.
- **AD4.3 — Standing is configuration, not code.** Classification bands
  (`{label, minGpa}`) live in the `grading.standingBands` setting (Phase 3
  registry), so different institutions classify differently without code changes.
- **AD4.4 — Provenance is wireable but deferred.** The loader resolves a scale by
  id/name; recording the chosen `gradeScaleId` on a `Result` is Phase 9 work atop
  the pre-Phase-5 schema bundle (F-19).

---

## Database Changes

- **None to the schema shape.** `GradeScale`, `AssessmentConfig` exist and are
  seeded (Phase 1); the standing bands are a `Setting` (Phase 3 mechanism).
- **Seed addition:** default `grading.standingBands` setting (e.g. First/Second
  Upper/Second Lower/Pass/Fail by minGpa) `[ASSUMPTION]` — confirm the
  classification for the target institution.

---

## UI Screens

**None in Phase 4.** Future consumers (deferred): grade-scale editor, assessment-
structure editor, standing-bands editor (Phase 8 / shell).

---

## Services (contracts)

- `GradingConfigService`:
  - `loadGradeScale(ref?: { id?: string; name?: string }): Promise<GradeScale>`
  - `loadAssessmentStructure(name?: string): Promise<AssessmentStructure>`
  - `loadStandingBands(): Promise<StandingBand[]>`
  - throws `GradeScaleError` / `AssessmentError` / `SettingsError` on invalid stored config.
- Engines unchanged: `GpaEngine.processSemester`, `.computeCumulative`,
  `GpaEngine.resolveStanding(gpa, bands)`.

---

## Validation Rules

- Stored grade-scale bands must pass `GradeScale.create` (0–100, no gaps/overlaps);
  assessment components must sum to 100; standing bands validated (numbers,
  sorted, labelled). Failure → typed error, surfaced to the operator.
- The loader resolves "default" deterministically (the `isDefault` row / the
  registered default scale name from settings).

---

## Test Plan

| Test                                  | Asserts                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| Engine adoption                       | existing engine suites still green (regression)                                   |
| `GradingConfigService.loadGradeScale` | parses+validates stored bands; returns a working `GradeScale`; default resolution |
| invalid stored scale                  | a gap/overlap/weights≠100 in the DB JSON throws the typed error (fail-loud)       |
| `loadAssessmentStructure`             | parses components; rejects weights≠100                                            |
| `loadStandingBands` + standing        | bands from settings classify a GPA correctly; empty ⇒ "Unclassified"              |
| coverage                              | ≥80% on new domain+application code                                               |

All headless against in-memory fakes; engines already run with no DB.

---

## Risks

| ID   | Risk                                                | Mitigation                                                         |
| ---- | --------------------------------------------------- | ------------------------------------------------------------------ |
| P4-a | Stored config drifts from value-object invariants   | loader validates on every read; fail-loud (AD4.2)                  |
| P4-b | Treating reference engines as "done" without review | explicit adoption review (D1) against design/ADRs                  |
| P4-c | Standing classification differs per institution     | bands are a setting (AD4.3); default flagged `[ASSUMPTION]`        |
| P4-d | Provenance gap (F-19) forgotten                     | tracked to Phase 9 + pre-P5 bundle; loader resolves by id/name now |

---

## Completion Criteria

- [ ] Engines reviewed + adopted; all engine tests green.
- [ ] `GradingConfigService` loads + validates grade scale / assessment / standing
      from the DB at one choke point (F-6 closed).
- [ ] `demo:grading` loads the default scale from `dev.db` and prints GPA + standing.
- [ ] Tests pass; coverage ≥80% on new code; `tsc` strict clean; lint/format clean.
- [ ] Boundaries intact (engines pure; fitness test green).
- [ ] `/docs` updated; summary posted; **approval requested before Phase 5.**

---

## Approval Checklist (to start Phase 4 implementation)

- [ ] Scope confirmed: adopt engines + add the validated config loader + configurable standing.
- [ ] Default standing classification (D2) acceptable, or provide the institution's bands.
- [ ] Confirm engines stay pure (provenance deferred to Phase 9).
- [ ] Go-ahead to write Phase 4 implementation code.

_Related: [architecture-review.md](../phase-0/architecture-review.md) (F-6, F-19) ·
`README.md` "Reference implementation" · [phase-3 implementation notes](../phase-3/implementation-notes.md)_
