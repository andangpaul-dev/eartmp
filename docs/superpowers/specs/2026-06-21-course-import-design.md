# Bulk course import

**Date:** 2026-06-21
**Status:** Approved (pending final spec review)
**Scope:** Add the ability to bulk-import courses from a spreadsheet, scoped per
programme → level → semester, with columns **Course code | Course title | Credit
Value | Course type** — mirroring the existing student-import flow. Plus a
downloadable template for **both** the new course import and the existing student
import.

---

## 1. Decisions captured

- **Semester = `Course.semesterRank`** (1 or 2 — "which semester of the level").
  There is no calendar-Semester link on a course; the batch picks a rank and every
  row inherits it.
- **Upsert on import.** A row whose `code` already exists **updates** that course
  (title, credit, type, and re-places it to the batch programme/level/semester/
  department); a new `code` is **created**. In-file duplicate codes are a row
  error. (Because course codes are **globally unique**, an upsert re-places an
  existing course into the batch's placement — the import is authoritative on
  placement. Accepted.)
- **Downloadable templates for both** course and student imports.
- **Course-type parsing:** case-insensitive against `CORE | ELECTIVE | PRACTICAL |
CLINICAL`; required (blank/invalid → row error).
- **No per-faculty scoping needed:** only `SUPER_ADMIN` and `REGISTRAR` hold
  `courses.create`/`courses.update`, and both are institution-wide.
- **Approach A:** a dedicated `ImportCourses` use-case + `ImportCoursesScreen`
  mirroring `ImportStudents`. Rejected: a generic students+courses importer
  (tangles two flows); UI-loop of `createCourse` (not atomic, no report/upsert).

## 2. What exists (reused, not rebuilt)

- **`ImportStudents`** (`src/application/use-cases/records/ImportStudents.ts`) —
  the pattern: batch-level scoping + per-row column aliases, validation pass then
  write pass in **one `uow.run` transaction** (all-or-nothing), a per-row report.
- **`parseWorkbook`** (host registry) + `SheetJsReader`
  (`src/infrastructure/import/SheetJsReader.ts`) turn an uploaded file's bytes into
  `RawRow[]` (`{ [header]: string|number }`). The UI base64-encodes the file and
  calls `parseWorkbook({ base64 })`.
- **Course model + use-cases** (`ManageCourses.ts`): `Course = { id, code, title,
creditValue, courseType, departmentId?, subDepartmentId?, programmeId?, levelId?,
institutionId?, semesterRank? }`. `code` is **globally unique among live rows**
  (partial index `Course_code_live_key`). `CourseRepository` (in the transactional
  bundle) has `create`, `update`, `findByCode` (live rows).
- **`TransactionalRepos.courses`** is already available inside `uow.run`.
- **UI reference:** `ImportStudentsScreen.tsx` (cascade scope, file upload,
  validate/commit, inline column help — **no template download today**).

## 3. `ImportCourses` use-case

`src/application/use-cases/records/ImportCourses.ts`,
`requiredPermissions = ["courses.create", "courses.update"]` (upsert touches both),
audited.

```ts
export interface ImportCoursesInput {
  rows: RawRow[];
  programmeId?: string;
  levelId?: string;
  semesterRank?: number;
  departmentId?: string;
  dryRun?: boolean;
}
export interface CourseImportRowError {
  row: number;
  messages: string[];
}
export interface CourseImportReport {
  totalRows: number;
  validRows: number;
  created: number; // 0 on dryRun / errors
  updated: number; // 0 on dryRun / errors
  errors: CourseImportRowError[];
}
```

**Per-row parsing** (aliases — accept the human headers AND camelCase):

- `code` ← `code | "Course code" | courseCode`
- `title` ← `title | "Course title" | name`
- `creditValue` ← `Number(creditValue | "Credit Value" | credits)`
- `courseType` ← `(courseType | "Course type" | type).toUpperCase()`

**Validation pass** (inside `uow.run`, read-only): `code` non-empty; `title`
non-empty; `creditValue` a positive integer; `courseType` ∈ the four values;
in-file duplicate `code` (case-insensitive) → row error. Classify each valid row
as create vs update via `repos.courses.findByCode(code)` (same transaction →
TOCTOU-safe). Collect all errors.

**Write pass** (only when not dry-run and zero errors): for each valid row, if it
matched an existing course → `repos.courses.update(id, { title, creditValue,
courseType, programmeId, levelId, semesterRank, departmentId })`; else
`repos.courses.create({ code, title, creditValue, courseType, programmeId,
levelId, semesterRank, departmentId })`. Tally `created`/`updated`. One
`repos.audit.record({ action: "IMPORT", entity: "Course", ... })` with counts +
placement. Because everything runs in the single transaction, any failure rolls
the whole batch back.

## 4. Template helper

A small **client-side** util (presentation layer) — no host round-trip:

```ts
// downloads a CSV containing only the header row
function downloadCsvTemplate(filename: string, headers: string[]): void;
```

It builds a `Blob` (`headers.join(",") + "\n"`) and triggers an anchor download.

- Course headers: `["Course code", "Course title", "Credit Value", "Course type"]`.
- Student headers: `["matricNumber", "fullName", "regNumber", "gender", "nationality"]`.

CSV (not xlsx) keeps it dependency-free in the browser; the importer already
accepts CSV. The header names are exactly what the row-alias parser recognises.

## 5. UI

- **New `ImportCoursesScreen`** (mirrors `ImportStudentsScreen`):
  - Scope cascade **Department → Programme → Level → Semester (1 / 2)** (department
    sourced from the existing structure lists; semester is a 1/2 quick-pick).
  - **Download template** button → `downloadCsvTemplate("courses-template.csv",
courseHeaders)`.
  - File input → `parseWorkbook({ base64 })` → preview (filename + row count).
  - **Validate** → `importCourses({ ...scope, dryRun: true })` → report table
    (per-row errors; created/updated counts).
  - **Commit** (enabled only when the dry-run has zero errors) →
    `importCourses({ ...scope })` → "Created N, updated M."
  - Nav entry in the Records group, gated by `courses.create`.
- **Retrofit `ImportStudentsScreen`** with the same **Download template** button
  (`downloadCsvTemplate("students-template.csv", studentHeaders)`).

## 6. Targeted fix: `parseWorkbook` gating

`parseWorkbook` is currently gated by `results.import`. That means a **REGISTRAR**
(who has `students.create`/`courses.create` but not `results.import`) cannot run
_any_ import — the file-parse step denies them before the import use-case is even
reached (a latent over-restriction that affects the existing student import too).

Parsing an uploaded file into rows is **non-mutating** — the sensitive write is the
import use-case, which is permission-gated. So relax `parseWorkbook` to **any
authenticated session** (no specific permission). This unblocks course import and
fixes the latent student-import gap. (The narrow per-feature gating stays on the
actual `importCourses`/`importStudents`/`importResults` use-cases.)

## 7. Wiring, layering & testing

- **Layering.** `ImportCourses` is an application use-case over the repository
  ports; the template helper is pure presentation; the UI calls the core. No UI
  touches the DB.
- **Seams:** add `importCourses` to `contract.ts`, a Zod schema in
  `inputSchemas.ts`, construct + register `new ImportCourses(uow)` via `authorize`
  in `composition.ts`, add the `ipcClient` method + `makeCore` harness default;
  change the `parseWorkbook` registry guard to authenticated-only.
- **Tests (Vitest):**
  - Use-case: create-new rows; **upsert** an existing code (updates fields +
    re-places, increments `updated`); in-file duplicate → error; invalid
    `courseType` and non-positive `creditValue` → errors; **dry-run writes
    nothing**; a bad row makes the whole batch write nothing (all-or-nothing);
    header-alias parsing (`"Course code"` etc.) works.
  - Template helper: produces the exact header row for courses + students.
  - Host: `importCourses` validates (Zod) + routes through `authorize`;
    `parseWorkbook` no longer requires `results.import` (an authenticated session
    without it succeeds).
  - UI: course screen cascade + download-template + validate shows created/updated
    - commit calls `importCourses` with the scope; student screen download button.
  - Boundary fitness unaffected.

## 8. Definition of done

- [ ] `ImportCourses` use-case (upsert, all-or-nothing, alias parsing, report) + tests.
- [ ] Client-side `downloadCsvTemplate` helper + test.
- [ ] `ImportCoursesScreen` (cascade, template, validate/commit) + nav entry + tests.
- [ ] Student import screen gains the Download-template button.
- [ ] `parseWorkbook` gating relaxed to authenticated-only (+ test).
- [ ] Contract/host/zod/ipc/harness wiring for `importCourses`.
- [ ] Tests green; `tsc` strict + lint + boundary fitness clean.
- [ ] `/docs` updated; summary posted.

## 9. Out of scope (future work)

- `.xlsx` (vs CSV) template generation.
- Per-row programme/level overrides (placement is batch-level, like student import).
- Course delete/deactivate via import.
- Sub-department placement via import (only department/programme/level/semester).
