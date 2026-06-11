# Phase 15 — Transcript Template Designer

**Project:** EARTMP · **Phase:** 15 · **Status:** Plan drafted, awaiting approval
to implement · **Predecessor:** Phase 14 (implemented)

> Deliverables-before-implementation spec, in the mandated format. Nothing is
> built until you approve. Logic + validation only; the visual drag-and-drop
> designer UI is shell-deferred. Same proof model: headless, ≥80% coverage, dev
> Prisma adapter, runnable demo.

---

## Executive Summary

Phase 15 makes transcript **template layouts** first-class, editable configuration.
It adds CRUD over `TranscriptTemplate` — **create / update / clone / set-default /
delete / list** — each **validated against the block grammar** (the binder's
contract) plus an optional **sample-bind dry run** (bind the layout to a synthetic
`ReportData` to catch bad `bind` paths before saving). Updates **bump the version**.
This closes the "grading systems, transcript layouts… always runtime-configured,
never hardcoded" rule (BSD §2) for transcripts. Existing issued transcripts are
unaffected — they carry their own frozen snapshot (Phase 12).

---

## Scope & sequencing

| Concern                                                    | Phase 15          | Deferred to        |
| ---------------------------------------------------------- | ----------------- | ------------------ |
| Template CRUD (create/update/clone/setDefault/delete/list) | ✅ built + tested | —                  |
| Layout **block-grammar validation** (no data)              | ✅                | —                  |
| **Sample-bind dry run** (catch bad binds pre-save)         | ✅                | —                  |
| Versioning (bump on update)                                | ✅                | —                  |
| Single default + guarded delete                            | ✅                | —                  |
| Visual drag-and-drop **designer UI**                       | ⛔                | Shell phase        |
| Live preview render (PDF) in the editor                    | ⛔                | Shell (reuses P13) |

---

## Objectives

1. A pure **`validateTemplateLayout(layout)`** — walks the block tree and returns
   structured errors (unknown block, missing required prop, bad `sessionLoop`
   nesting) **without** needing data. Derived from the binder grammar.
2. A **sample-bind dry run** — bind the layout to a synthetic `ReportData`; bind
   errors (unresolved required `bind`) surface as validation errors pre-save.
3. **CRUD use-cases** over `TranscriptTemplate`: `CreateTemplate`,
   `UpdateTemplate` (re-validate + **version bump**), `CloneTemplate`,
   `SetDefaultTemplate`, `DeleteTemplate` (guard the default), `ListTemplates`.
4. **Single default per institution**; **guarded delete** (can't delete the
   default or a template referenced by issued transcripts).

**Out of scope:** designer UI, in-editor live preview, multi-tenant templates.

---

## Deliverables

| #   | Deliverable                                                                                                                                                     | Layer          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| D1  | `validateTemplateLayout(layout): string[]` (pure, block-grammar) + `dryRunBind(layout)` against a sample ReportData                                             | domain         |
| D2  | Extend the template port to a full store: `list`, `create`, `update`, `softDelete`, `setDefault`, `countTranscriptsUsing` (+ existing `findById`/`findDefault`) | domain + infra |
| D3  | Use-cases: `CreateTemplate`, `UpdateTemplate` (re-validate + version bump), `CloneTemplate`, `SetDefaultTemplate`, `DeleteTemplate` (guarded), `ListTemplates`  | application    |
| D4  | Seed: `templates.read` + `templates.manage` permissions (granted to SUPER_ADMIN/REGISTRAR)                                                                      | seed           |
| D5  | Dev-only Prisma template store extended to the full port                                                                                                        | infra (dev)    |
| D6  | `scripts/demo-template.ts` — create valid · **reject invalid layout** · version bump on edit · clone · set-default · guarded delete · list                      | scripts (dev)  |
| D7  | Tests (≥80%) — validator matrix, dry-run bad-bind, version bump, single default, guarded delete, authz                                                          | tests          |
| D8  | `/docs` update + implementation notes                                                                                                                           | docs           |

---

## Architecture Decisions

- **AD15.1 — Validation is the binder grammar, shared.** `validateTemplateLayout`
  encodes the same block grammar the binder enforces, so a template that validates
  here will bind at generation time. The sample-bind dry run is the belt-and-braces
  check for `bind` paths (F-29 — keep the grammar small + validated).
- **AD15.2 — Validate before persist (AD8.1 pattern).** Every create/update
  validates the layout (grammar + dry run) before writing — never store a template
  that would blow up at generation time.
- **AD15.3 — Version bump, not history rows.** `UpdateTemplate` increments
  `version`. Issued transcripts are unaffected (they snapshot their layout, P12), so
  a full version-history table is unnecessary for v1 (notable, not built).
- **AD15.4 — Single default + guarded delete.** One default per type; the default
  can't be deleted, nor can a template referenced by issued transcripts
  (`countTranscriptsUsing > 0`) — protects reproducibility.
- **AD15.5 — Templates are config, gated by `templates.manage`** — runtime-
  configured, never hardcoded (BSD §2).

---

## Database Changes

- **None to the schema shape** — `TranscriptTemplate` exists (Phase 1) with
  `name`, `version`, `layout` (JSON), `isDefault`, soft-delete, FK from
  `Transcript.templateId`.
- **Seed:** `templates.read` + `templates.manage` permissions.

---

## UI Screens

**None in Phase 15.** Future consumer (deferred): the drag-and-drop designer with
in-editor live preview (reuses the Phase 13 renderer).

---

## Services / Use-cases (contracts, abridged)

- `validateTemplateLayout(layout: unknown): string[]` (empty = valid)
- `CreateTemplate.execute({ name, layout, isDefault? }, session)` → `templates.manage`
- `UpdateTemplate.execute({ id, name?, layout? }, session)` → re-validate + version++
- `CloneTemplate.execute({ id, name }, session)`
- `SetDefaultTemplate.execute({ id }, session)`
- `DeleteTemplate.execute({ id }, session)` (guarded)
- `ListTemplates.execute({}, session)` → `templates.read`

---

## Validation Rules

- Layout parses to an object with a `blocks` array; every block has a known
  `type`; required props present; `sessionLoop.block` is a `courseTable`.
- Sample-bind dry run resolves all required `bind` paths (uses a synthetic
  ReportData) — unresolved → error.
- Single default; the default and in-use templates can't be deleted.
- All writes authorized (`templates.manage`, fail-closed) + audited; reads
  `templates.read`.

---

## Test Plan

| Test                | Asserts                                                                               |
| ------------------- | ------------------------------------------------------------------------------------- |
| validator (grammar) | unknown block / missing prop / bad sessionLoop nesting → errors; a good layout → none |
| dry-run bind        | a layout binding a missing field is rejected pre-save                                 |
| create/update       | persisted; **update bumps version**; invalid layout rejected on save                  |
| clone               | copies layout, new name, not default                                                  |
| default + delete    | single default; default + in-use templates can't be deleted                           |
| authz               | manage gated by `templates.manage`; reads by `templates.read`                         |
| coverage            | ≥80% on new code                                                                      |

---

## Risks

| ID    | Risk                                               | Mitigation                                                                                  |
| ----- | -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| P15-a | Validator drifts from the binder grammar           | both derive from one shared block-spec; a test binds every validated demo layout            |
| P15-b | Sample ReportData misses real fields               | synthetic sample mirrors the pinned ReportData shape; expands with it                       |
| P15-c | Deleting an in-use template breaks reproducibility | guarded delete (AD15.4); snapshots already protect issued transcripts                       |
| P15-d | No version history                                 | acceptable — issued transcripts snapshot their layout; flagged if history is later required |

---

## Completion Criteria

- [ ] Pure layout validator (+ dry-run) and template CRUD (versioned, single
      default, guarded delete) built, gated, audited.
- [ ] `demo:template` shows create / invalid-rejected / version-bump / clone /
      set-default / guarded-delete / list.
- [ ] Tests pass; coverage ≥80% on new code; `tsc` strict clean; lint/format clean.
- [ ] Boundaries intact (validator pure; fitness test green).
- [ ] `/docs` updated; summary posted; **approval requested before Phase 16.**

---

## Approval Checklist (to start Phase 15 implementation)

- [ ] Scope confirmed: template CRUD + layout validation + versioning, logic only (designer UI shell-deferred).
- [ ] **Validation:** block-grammar validator **plus** a sample-bind dry run — OK?
- [ ] **Versioning:** bump `version` on update (no separate history table) — OK?
- [ ] New `templates.read` + `templates.manage` permissions — OK?
- [ ] Single default + guarded delete (incl. in-use templates) — OK.
- [ ] Go-ahead to implement.

_Related: [transcript-template-architecture.md](../phase-0/transcript-template-architecture.md) ·
[phase-12 implementation notes](../phase-12/implementation-notes.md) (binder grammar) ·
[phase-8 implementation notes](../phase-8/implementation-notes.md) (config-management pattern)_
