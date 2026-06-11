# Phase 8 — Assessment & Grading Configuration

**Project:** EARTMP · **Phase:** 8 · **Status:** Plan drafted, awaiting approval
to implement · **Predecessor:** Phase 7 (implemented)

> Deliverables-before-implementation spec, in the mandated format. Nothing is
> built until you approve. Same proof model: headless domain/application logic,
> ≥80% coverage, dev Prisma adapters, runnable demo; UI + Tauri-SQL persistence
> deferred to the shell phase.

---

## Executive Summary

Phase 4 gave us the **read side** of grading config — `GradingConfigService`
loads and validates the default grade scale / assessment structure / standing
bands (closing F-6). Phase 8 adds the **write side**: administrators can
**create, edit, delete, and choose the default** grade scale and assessment
structure. Every write is **validated through the domain value objects**
(`GradeScale.create` / `AssessmentStructure.create`) before it touches the DB —
so a scale with a gap/overlap, or components that don't sum to 100, is rejected
on save, not discovered later. Permission-gated and audited.

---

## Scope & sequencing

| Concern                                 | Phase 8                                                      | Deferred to |
| --------------------------------------- | ------------------------------------------------------------ | ----------- |
| Grade-scale CRUD + set-default          | ✅ built + tested                                            | —           |
| Assessment-structure CRUD + set-default | ✅ built + tested                                            | —           |
| Validation on **write** (value objects) | ✅                                                           | —           |
| Standing bands management               | already done (a `Setting`, Phase 3/4) — reused, not re-built | —           |
| Concrete Tauri-SQL persistence          | ⛔                                                           | Shell phase |
| UI screens (editors)                    | ⛔                                                           | Shell phase |

---

## Objectives

1. **Grade scales:** create / update / delete (soft) / list / set-default, with
   bands validated via `GradeScale.create` on every write.
2. **Assessment structures:** create / update / delete (soft) / list /
   set-default, with components validated via `AssessmentStructure.create`.
3. **Single default per type:** setting a default clears the flag on the others
   (one default grade scale, one default assessment structure).
4. **Guarded delete:** the current default cannot be deleted while it is the
   default (must pick another first) — fail-closed.

**Out of scope:** results processing (Phase 9), UI, Tauri-SQL persistence,
standing-bands editing (already a settings use-case from Phases 3–4).

---

## Deliverables

| #   | Deliverable                                                                                                                                                      | Layer         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| D1  | Extend grading ports: write methods on `GradeScaleConfigRepository` (`create`/`update`/`softDelete`/`setDefault`/`list`) + same for `AssessmentConfigRepository` | domain        |
| D2  | `ManageGradeScales` use-cases: `CreateGradeScale`, `UpdateGradeScale`, `DeleteGradeScale`, `SetDefaultGradeScale`, `ListGradeScales`                             | application   |
| D3  | `ManageAssessmentConfigs` use-cases: `Create`/`Update`/`Delete`/`SetDefault`/`List`                                                                              | application   |
| D4  | Write-side validation: every create/update routes bands/components through `GradeScale.create` / `AssessmentStructure.create` (rejects invalid config)           | application   |
| D5  | Dev-only Prisma write repositories for `GradeScale` / `AssessmentConfig`                                                                                         | infra (dev)   |
| D6  | Seed: `config.read` permission (config.manage already seeded)                                                                                                    | seed          |
| D7  | `scripts/demo-config.ts` — create a scale, reject an invalid one, set default, list                                                                              | scripts (dev) |
| D8  | Tests (≥80% coverage on new domain+application code)                                                                                                             | tests         |
| D9  | `/docs` update + implementation notes                                                                                                                            | docs          |

---

## Architecture Decisions

- **AD8.1 — Validate on write through the value objects.** `CreateGradeScale`/
  `UpdateGradeScale` call `GradeScale.create(bands)` before persisting; the same
  for `AssessmentStructure.create(components)`. This is the write-side choke point
  that complements the Phase 4 read-side loader — invalid config can enter the DB
  from neither direction.
- **AD8.2 — Single default per type (like the current session, AD5.5).**
  `SetDefault` sets `isDefault=true` on the target and clears it on the others in
  the same operation.
- **AD8.3 — Stored as JSON with `schemaVersion`-style discipline.** Bands/
  components are stored as JSON (existing columns); the value objects are the
  schema. (A future migration can add an explicit version field per the F-25
  pattern if shapes evolve.)
- **AD8.4 — Guarded delete.** Deleting the active default is rejected until
  another default is chosen, so the institution always has a usable default.
- **AD8.5 — Writes are permission-gated (`config.manage`) + audited** (old→new).

---

## Database Changes

- **None to the schema shape** — `GradeScale` and `AssessmentConfig` exist
  (Phase 1) with `name` (unique), `bands`/`components` (JSON), `isDefault`.
- **Seed addition:** `config.read` permission (granted to SUPER_ADMIN/REGISTRAR);
  `config.manage` already seeded.

---

## UI Screens

**None in Phase 8.** Future consumers (deferred): grade-scale editor (bands
table), assessment-structure editor (weighted components), default selector.

---

## Services / Use-cases (contracts, abridged)

- `CreateGradeScale.execute({ name, bands }, session)` → `config.manage`;
  validates via `GradeScale.create`; rejects duplicate live name; audits.
- `SetDefaultGradeScale.execute({ id }, session)` → `config.manage`; clears other
  defaults; audits.
- `DeleteGradeScale.execute({ id }, session)` → `config.manage`; rejects if it is
  the current default; soft-delete; audits.
- `ListGradeScales.execute({}, session)` → `config.read`.
- (Assessment-structure use-cases mirror the above.)

---

## Validation Rules

- Grade-scale bands must pass `GradeScale.create` (0–100, no gaps/overlaps,
  valid grade points); assessment components must pass
  `AssessmentStructure.create` (weights sum to 100, unique keys, positive
  maxScore).
- `name` non-empty + unique among live rows.
- Exactly one default per type; the default cannot be deleted while default.
- All writes authorized (fail-closed) + audited; lists permission-gated.

---

## Test Plan

| Test                 | Asserts                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| CreateGradeScale     | valid bands persist + audit; **invalid bands (gap/overlap) rejected**; duplicate live name rejected |
| UpdateGradeScale     | re-validates bands on edit; invalid update rejected                                                 |
| SetDefaultGradeScale | target becomes default; others cleared (single default)                                             |
| DeleteGradeScale     | non-default soft-deletes; deleting the current default rejected                                     |
| AssessmentConfig     | weights≠100 rejected; default + delete guards mirror grade scale                                    |
| authz/audit          | writes gated by `config.manage`; reads by `config.read`                                             |
| coverage             | ≥80% on new code                                                                                    |

All headless against in-memory fakes.

---

## Risks

| ID   | Risk                                             | Mitigation                                                                                 |
| ---- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| P8-a | Invalid config saved bypassing the value objects | single write-side choke point (AD8.1); a test feeds invalid bands/components               |
| P8-b | No default after a delete                        | guarded delete (AD8.4)                                                                     |
| P8-c | Two defaults via a race                          | single-writer v1; the set-default op clears others; UoW-wrap available (Phase 7) if needed |
| P8-d | JSON shape drift later                           | value objects are the schema; F-25 versioning pattern available                            |

---

## Completion Criteria

- [ ] Grade-scale + assessment-structure CRUD, default selection, guarded delete
      built, gated, audited; write-side validation enforced.
- [ ] `demo:config` creates/rejects/sets-default/lists end-to-end.
- [ ] Tests pass; coverage ≥80% on new code; `tsc` strict clean; lint/format clean.
- [ ] Boundaries intact (fitness test green).
- [ ] `/docs` updated; summary posted; **approval requested before Phase 9.**

---

## Approval Checklist (to start Phase 8 implementation)

- [ ] Scope confirmed: grade-scale + assessment-structure management, logic only.
- [ ] **Single default per type** + **guarded delete of the default** — OK.
- [ ] New `config.read` permission — OK.
- [ ] Standing bands stay managed via the existing settings use-case (not re-built) — OK.
- [ ] Go-ahead to implement.

_Related: [architecture-review.md](../phase-0/architecture-review.md) (F-6) ·
[phase-4 engine-adoption-review](../phase-4/engine-adoption-review.md) ·
`src/application/services/GradingConfigService.ts` (the read side)_
