# Editable grading system (Workstream D)

**Date:** 2026-06-20
**Status:** Approved (pending final spec review)
**Scope:** Item 7 of the records upgrade set — make the grading system editable
through the UI: **grade scales (bands)**, **assessment structures (components)**,
and **standing/classification bands**. The domain value-objects and the
create/update/delete use-cases already exist; this workstream is mostly
**exposing** them on the contract and **building the editors**.

---

## 1. Decisions captured

- **Editable scope:** grade scales, assessment structures, and standing bands.
  **Out of scope:** per-level scale-picker refinement (already works via
  `StructureScreen` + `Level.gradeScaleId`).
- **Edit vs history (forward-only).** Editing or deleting a grading config
  affects **future processing only**. Already-processed results keep their
  original grades — provenance protects history (`Result.gradeScaleId` /
  `assessmentConfigId` are stamped at processing; `AcademicSummary` reads stored
  grade points and never re-grades, AD11.1). Each editor states this plainly. No
  bulk re-processing is triggered (re-grading stays the existing explicit
  `ProcessSemester` action).
- **Approach A (inline editors).** Make the existing read-only Grading tab of
  `ConfigurationScreen` editable (New/Edit/Delete + modals + a standing-bands
  editor). Rejected: a separate Grading screen (needless nav split at this size);
  a raw JSON editor (bypasses live validation, error-prone for registrars).

## 2. What already exists (no change needed)

- **Domain VOs** (`src/domain/value-objects/GradeScale.ts`,
  `AssessmentStructure.ts`) with full validation:
  - `GradeScale.create(bands)` — bands cover 0–100, sorted, no gaps/overlaps,
    marks in range, `gradePoint ≥ 0`; `resolve(mark)`; `isPass` per band.
  - `AssessmentStructure.create(components)` — keys unique, each weight 0–100,
    **weights sum to 100** (1e-6 tolerance), `maxScore > 0`;
    `computeFinalScore(scores)`.
- **Use-cases** (`src/application/use-cases/config/ManageGradeScales.ts`,
  `ManageAssessmentConfigs.ts`), all `config.manage`, audited:
  `CreateGradeScale`, `UpdateGradeScale`, `DeleteGradeScale` (blocks deleting the
  default), `SetDefaultGradeScale`, `ListGradeScales`; and the matching five for
  assessment configs.
- **`GradingConfigService`** — the validated gateway (`loadGradeScale`,
  `loadGradeScaleWithId`, `loadAssessmentStructure`, `loadStandingBands`).
- **Standing bands** — the `grading.standingBands` setting
  (`{ label, minGpa }[]`), resolved by `GpaEngine.resolveStanding` (highest
  `minGpa ≤ gpa` wins). Editable via the existing `getSetting`/`setSetting`.
- **Contract today** exposes only `listGradeScales` / `setDefaultGradeScale` /
  `listAssessmentConfigs` / `setDefaultAssessmentConfig` and `getSetting` /
  `setSetting`. The UI Grading tab is **read-only** (lists + set-default).

## 3. Backend wiring (the only backend work)

Expose the existing use-cases to the webview (mirror the Workstream A/B/C wiring
across the five seams):

- **`contract.ts`** — add `createGradeScale(input: { name, bands })`,
  `updateGradeScale(input: { id, name?, bands? })`, `deleteGradeScale(input: { id })`,
  and the three assessment equivalents
  (`createAssessmentConfig`/`updateAssessmentConfig`/`deleteAssessmentConfig`,
  inputs `{ name, components }` / `{ id, name?, components? }` / `{ id }`). Reuse
  the existing `StoredGradeScale` / `StoredAssessmentConfig` / `GradeBand` /
  `AssessmentComponent` view types.
- **`inputSchemas.ts`** — Zod schemas (bands/components as arrays of looseObjects;
  ids/names as strings). Defense-in-depth on top of the domain validation.
- **`composition.ts`** — register registry thunks through
  `authorize(useCase, input, session)` (so `config.manage` is enforced).
  Construct any use-case instance not already built.
- **`ipcClient.ts`** — forwarding methods; **`tests/ui/harness.tsx`** — `makeCore`
  defaults for the 6 methods.
- **Standing bands:** no new backend — the editor uses `getSetting`/`setSetting`
  with `SETTING_KEYS.standingBands` ("grading.standingBands").

**Test gap:** `UpdateGradeScale` / `UpdateAssessmentConfig` exist but are
untested — add unit tests (name-only edit, bands/components edit, invalid edit
rejected, audit old→new).

## 4. Grade-scale editor (bands)

Grading tab gains **New scale** and per-scale **Edit** / **Delete** (Delete
disabled for the default — mirrors the use-case guard). The editor modal turns
the existing read-only `BandsTable` editable:

- **Name** input + a rows table: `minMark`, `maxMark`, `grade` (text),
  `gradePoint` (number), `isPass` (checkbox); add/remove rows; an "add band"
  default that starts after the last band's `maxMark`.
- **Live validation mirroring `GradeScale.create`**: marks in 0–100, `minMark ≤
maxMark`, `gradePoint ≥ 0`, sorted bands **cover 0–100 with no gaps/overlaps**.
  Inline errors; **Save disabled until valid**.
- Save → `createGradeScale` / `updateGradeScale`. The use-case re-runs
  `GradeScale.create`, so the server is authoritative; the UI check is fast
  feedback only. Server `ValidationError` (e.g. a duplicate name) renders inline.

## 5. Assessment-structure editor (components)

Same shape — **New structure** + Edit/Delete (Delete disabled for default). The
editable components table: `key` (stable id), `label`, `weight`, `maxScore`;
add/remove rows; a **prominent running weight total**. Live validation mirroring
`AssessmentStructure.create`: keys unique, `maxScore > 0`, each weight 0–100,
**total weight = 100** (Save disabled otherwise). Save →
`createAssessmentConfig` / `updateAssessmentConfig`.

> Editing a component `key` that existing results were scored against does not
> retro-change those results (provenance); the warning in §6 covers this.

## 6. Standing-bands editor & forward-only safeguards

- **Standing-bands editor** (new, in the Grading tab): loads
  `grading.standingBands` via `getSetting`; editable rows of `label` + `minGpa`
  (add/remove); validation — ≥1 band, non-empty labels, numeric `minGpa`. Save via
  `setSetting`. (Ordering is not enforced — the resolver sorts descending and
  takes the highest `minGpa ≤ gpa`.)
- **Forward-only note** in every editor: _"Changes apply to future processing
  only — already-processed results keep their original grades."_
- **Delete** stays soft + blocked for the default. A deleted scale referenced by
  historical results keeps those results' grades (provenance); a `Level` pointing
  at it falls back to the institution default at next processing.
- **Permissions:** all editors gated by `config.manage` (hidden for read-only
  operators — the screen already does permission checks); reads need `config.read`.

## 7. Layering & testing

- **Layering.** Validation logic stays in the domain VOs; the editors mirror it
  for live feedback but call the use-cases via the core (authoritative). No UI
  touches the DB. The host registry enforces permissions via `authorize`.
- **Tests (Vitest):**
  - Application: new `UpdateGradeScale` / `UpdateAssessmentConfig` unit tests
    (name-only, bands/components edit, invalid rejected, audit).
  - Host: the 6 new methods validate (Zod) + route through `authorize`.
  - Domain (already covered): `GradeScale.create` / `AssessmentStructure.create`
    invariants — reuse as the source of truth for the editors' validation.
  - UI: grade-scale editor (add/edit a band; a gap/overlap blocks Save; Save calls
    `createGradeScale` with the bands); assessment editor (weight total gating;
    Save calls `createAssessmentConfig`); standing-bands editor (Save calls
    `setSetting` with `grading.standingBands`); Delete disabled for the default;
    editors hidden without `config.manage`.
  - Boundary fitness unaffected (domain stays framework-free).

## 8. Definition of done

- [ ] Contract/host/ipc/zod/harness: `create/update/deleteGradeScale` +
      `create/update/deleteAssessmentConfig` exposed through `authorize`.
- [ ] `UpdateGradeScale` / `UpdateAssessmentConfig` unit tests added.
- [ ] Grade-scale editor (bands) with live cover-0–100 validation + New/Edit/Delete.
- [ ] Assessment-structure editor (components) with weight-sum-100 gating + New/Edit/Delete.
- [ ] Standing-bands editor via `getSetting`/`setSetting`.
- [ ] Forward-only warning in each editor; Delete disabled for the default;
      `config.manage` gating.
- [ ] Tests green; `tsc` strict + lint + boundary fitness clean.
- [ ] `/docs` updated; summary posted.

## 9. Out of scope (future work)

- Bulk re-processing of existing results after a config edit (re-grading stays the
  explicit `ProcessSemester` action).
- Per-level / per-programme scale-picker UI refinement (the association already
  exists; only the picker UX could be polished).
- Clone-to-version immutability for in-use configs.
