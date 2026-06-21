# Results import — align to the student-import principle

**Date:** 2026-06-21
**Status:** Approved (pending final spec review)
**Scope:** Bring the results import (`ImportResults` + `ImportScreen`) to UX parity
with the student/course imports — a downloadable template, inline column-help,
and column aliases — **plus** optional `sitting`/`status` columns so bulk import
can also load resits and DIDs (matching the manual entry grid).

---

## 1. Starting point (already aligned)

`ImportResults` (`src/application/use-cases/results/ImportResults.ts`) and
`ImportScreen` (`src/presentation/screens/ImportScreen.tsx`) already follow the
core principle: Session→Semester scope, file upload → `parseWorkbook`, **Validate
(dry-run) → per-row error report → Commit all-or-nothing** in one `uow.run`
transaction, with **upsert** (an existing NORMAL result updates, else creates).
The report is `ImportReport { totalRows, validRows, imported, errors }`.

**Gaps vs the student/course imports** (which were just retrofitted):

- No **Download-template** button.
- No **inline column-help** text.
- No **column aliases** — it requires exact `matricNumber` / `courseCode`.
- Columns are NORMAL-sitting / GRADED only — no `sitting`/`status` support.

The result columns are **dynamic**: `matricNumber`, `courseCode`, plus one column
per assessment component key (e.g. `ca`, `exam`) parsed from
`grading.loadAssessmentStructure()` (the default/active structure).

## 2. `ImportResults` use-case changes

- **Aliases:** `matricNumber` ← `matricNumber | matric | matricNo`;
  `courseCode` ← `courseCode | code | "Course code"`.
- **Optional `sitting` column:** parsed case-insensitively (`(row.sitting ?? row.Sitting)`),
  default `NORMAL`; validated against `NORMAL | RESIT` (via the existing
  `assertSitting`/`RESULT_SITTINGS` value-object) → unknown value is a row error.
- **Optional `status` column:** default `GRADED`; validated against
  `GRADED | DID | DISQUALIFIED | INCOMPLETE` (`assertStatus`/`RESULT_STATUSES`).
- **Non-graded rows carry no scores:** when `status !== "GRADED"`, **skip** the
  component-score presence/range validation and `computeFinalScore` — a
  DID/DISQUALIFIED/INCOMPLETE row needs only matric + course. It writes with that
  `status` and **no `finalScore`** (the create omits it; an update clears it via
  `finalScore: null`, the same path manual entry uses).
- **Sitting-aware dedupe + lookup:** the in-file duplicate key becomes
  `${matric}::${code}::${sitting}`, and the existing-result lookup matches
  `r.courseId === course.id && r.sitting === sitting` (was hard-coded `NORMAL`) —
  so a `RESIT` row no longer collides with the `NORMAL` row and upserts its own row.
- **Create/update carry `sitting` + `status`:** create
  `{ ..., sitting, status }`; update `updateScores(id, { componentScores,
finalScore: graded ? finalScore : null, status })`.
- **Locked existing rows still block** (unchanged): "Existing result is locked;
  unlock before importing."
- **No resit-eligibility enforcement** (decision): import is an authoritative bulk
  load; a `RESIT` row is accepted regardless of the prior attempt's state. The GPA
  engine's global effective-attempt selection produces the correct GPA either way.
- **Report shape unchanged:** `ImportReport { totalRows, validRows, imported,
errors }` (`imported` = rows written) — kept to match the student import; the
  screen already renders it.
- **Permission unchanged:** `results.import`.

## 3. Template & column-help (UX parity)

- **Download-template button** on `ImportScreen`: load `getAssessmentStructure()`
  for the active component keys, build CSV headers
  **`matricNumber, courseCode, <each component key>, sitting, status`** (the last
  two optional), and download via the existing client-side `downloadCsvTemplate`
  helper (`src/presentation/screens/import/csvTemplate.ts`). Dynamic, so the
  template always matches the configured assessment structure. Filename
  `results-template.csv`.
- **Inline column-help** text: required `matricNumber`, `courseCode`, and the
  component columns (e.g. `ca`, `exam`); optional `sitting` (NORMAL/RESIT, default
  NORMAL) and `status` (GRADED/DID/DISQUALIFIED/INCOMPLETE, default GRADED). Mirrors
  the student/course screens' help line.

## 4. Layering, security & testing

- **Layering.** Logic stays in the `ImportResults` use-case + the domain
  value-objects (`assertSitting`/`assertStatus`); the template helper is pure
  presentation; the screen calls the core. No UI touches the DB.
- **Security.** `ImportResults` stays gated by `results.import`; `parseWorkbook`
  is already authenticated-only.
- **Tests (Vitest):**
  - Use-case: alias parsing (`matric`/`code`/`"Course code"`); `sitting=RESIT`
    creates a row distinct from the NORMAL one (no in-file/DB collision);
    `status=DID` row imports with **no score columns required** and stores no
    finalScore; an invalid `sitting` or `status` value → row error; a non-graded
    update clears finalScore; locked existing row → blocked; dry-run writes
    nothing; all-or-nothing on any error.
  - UI: Download-template builds headers from `getAssessmentStructure` including
    `sitting`/`status`; the column-help text is present; existing validate/commit
    flow still works.
  - Boundary fitness unaffected.

## 5. Definition of done

- [ ] `ImportResults`: aliases + optional `sitting`/`status` (validated), non-graded
      rows skip scores, sitting-aware dedupe/lookup, create/update carry sitting+status.
- [ ] `ImportScreen`: Download-template (dynamic headers incl. sitting/status) +
      inline column-help.
- [ ] Tests green; `tsc` strict + lint + boundary fitness clean.
- [ ] `/docs` updated; summary posted.

## 6. Out of scope (future work)

- Changing the report to split created/updated counts (kept as `imported`).
- Resit-eligibility enforcement on import.
- A `subDepartment`/programme/level scope on results import (it targets a semester).
- An `.xlsx` (vs CSV) template.
