# Phase 15 — Implementation Notes & Verification

**Status:** Implemented. All gates green. **Awaiting approval to start Phase 16.**

Approved: template CRUD + layout validation + versioning (logic only); block-grammar
validator **plus** sample-bind dry run; version bump on update; new `templates.read`

- `templates.manage`; single default + guarded delete (incl. in-use).

---

## Verification evidence (commands run)

| Gate                | Command                 | Result                                                                                                           |
| ------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Type-check          | `npm run typecheck`     | **clean**                                                                                                        |
| Lint (+ boundaries) | `npm run lint`          | **0 errors**                                                                                                     |
| Format              | `npm run format:check`  | **conforms**                                                                                                     |
| Tests               | `vitest run`            | **225 passed** (43 files)                                                                                        |
| Seed                | `npm run db:seed`       | idempotent; `templates.read` + `templates.manage` added                                                          |
| End-to-end demo     | `npm run demo:template` | ✓ create · ✓ **invalid rejected on save** · ✓ version bump · ✓ clone · ✓ set-default · ✓ guarded delete · ✓ list |

> The real-render smoke tests (PDF/DOCX) were given a 30 s per-test timeout — they
> drive the actual `pdfmake`/`docx` engines and are slow under parallel load.

---

## What was built

- **`validateTemplateLayout`** (`domain/services/TranscriptTemplateValidation.ts`,
  pure) — a lightweight structural grammar check (object → `blocks[]` → known
  types) **plus a sample-bind dry run** through the real binder against a synthetic
  `SAMPLE_REPORT_DATA`, so unresolved required binds and bad `sessionLoop` nesting
  are caught before save (AD15.1/AD15.2). Returns a list of errors (empty = valid).
- **`TranscriptTemplateStore`** — extends the read port with `list` / `findByName`
  / `create` / `update` / `softDelete` / `setDefault` / `countTranscriptsUsing`;
  Prisma impl extended.
- **Management use-cases** (`application/use-cases/transcripts/ManageTemplates.ts`,
  `templates.manage` / `templates.read`): `CreateTemplate`, `UpdateTemplate`
  (re-validate + **version bump**, AD15.3), `CloneTemplate`, `SetDefaultTemplate`,
  `DeleteTemplate` (guards the default + in-use templates, AD15.4), `ListTemplates`
  — all audited.
- **Seed:** `templates.read` + `templates.manage` (SUPER_ADMIN/REGISTRAR).
  `scripts/demo-template.ts`.
- **Tests:** `template-validation.test.ts` (grammar + dry-run matrix) +
  `manage-templates.test.ts` (create/invalid-rejected/duplicate, version bump,
  clone, single default, guarded delete incl. in-use, authz).

---

## Decisions honoured

- **Validate before persist** (AD15.2) — invalid layouts rejected on save.
- **Version bump, not history rows** (AD15.3) — issued transcripts snapshot their
  own layout (P12), so they're unaffected by template edits.
- **Single default + guarded delete** (AD15.4) — default + in-use templates
  protected.
- **Templates are config** (BSD §2) — runtime-managed, gated by `templates.manage`.
- No schema changes.

---

## Definition of Done (CLAUDE.md)

- [x] Pure layout validator (+ dry run) and template CRUD (versioned, single
      default, guarded delete) built, gated, audited.
- [x] `demo:template` shows create / invalid-rejected / version-bump / clone /
      set-default / guarded-delete / list.
- [x] Tests pass (225); coverage ≥80%; `tsc` strict clean; lint/format clean.
- [x] Boundaries intact (validator pure; fitness test green).
- [x] `/docs` updated; summary posted; approval requested before Phase 16.

_Next: Phase 16 — Graduation & Eligibility (configurable graduation rules over the
academic summary: min CGPA, credits, no outstanding fails; eligibility report)._
