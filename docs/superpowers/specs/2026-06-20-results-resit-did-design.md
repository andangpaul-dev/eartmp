# Results entry, resit sessions & DID — design (Workstream B)

**Date:** 2026-06-20
**Status:** Approved (pending final spec review)
**Scope:** Items 2 & 3 of the records upgrade set — results entry organised
per academic year/semester → department → programme → course, resit
examinations (each semester has its own resit session), and DID (Did Not Sit)
handling on upload. Plus a cross-cutting **admin override** capability.

This builds on Workstream A (faculty-scoped RBAC), which is already shipped:
the entry/records surfaces here are faculty-scoped by reuse, not redesign.

---

## 1. Decisions captured (the model we are building)

The institution follows the **University of Buea / Bamenda** resit model:

- **DID = Did Not Sit / absent.** A distinct result status (not a zero, not a
  normal fail). Entered as a marker on upload/grid. **Before a resit it counts
  as an F** in GPA (credit attempted, 0 quality points). The transcript shows
  the failing grade `F` (DID is just how that F arose). DID makes a student
  eligible for the resit.
- **Resit = dual entry.** Both the original failed attempt (`F`) **and** the
  resit attempt are printed on the transcript. The **resit grade counts in
  GPA/CGPA**; the original F is discounted (kept for the paper trail). The resit
  grade is annotated with an asterisk — e.g. `C*` — and the transcript legend
  gains **"\* Mark obtained after Resit"**. No cap on the resit grade.
- **Each semester has its own resit session** — a _sitting_ within the same
  semester, not a separate period. The resit therefore appears under the same
  semester as the original on the transcript.
- **Entry: both modes.** A course-roster batch grid (primary) and per-student
  entry (for corrections). Organised per year/semester → department → programme
  → course → sitting.
- **Admin override** (added during review): a privileged operator may bypass the
  academic-process restrictions (locks, resit eligibility, roster membership) for
  administrative flexibility. Tenant isolation is never overridable. Every
  override is audited.

### Chosen structural approach (A)

Add two columns to `Result` and relax its unique key to include the sitting.
Both attempts are sibling rows under the same semester. Rejected alternatives:
a separate "resit semester" period (breaks dual-entry-under-one-semester and
per-course GPA override); a full attempt-history child table (a large refactor
of a working pipeline for marginal gain over A).

---

## 2. Data model

`Result` gains two string fields (strings, matching how `calendarType`,
`courseType`, `Student.status` are already modelled — not Prisma enums; a domain
value-object guards allowed values):

```prisma
model Result {
  // ... existing fields ...
  sitting  String  @default("NORMAL")  // NORMAL | RESIT
  status   String  @default("GRADED")  // GRADED | DID

  @@unique([studentId, courseId, semesterId, sitting])  // was: without sitting
  // existing indexes unchanged
}
```

- **`sitting`** — `NORMAL` (regular sitting) or `RESIT` (the semester's resit
  session). The asterisk is **derived** from `sitting = RESIT` at render time;
  there is no stored asterisk/`isResit` flag — one source of truth.
- **`status`** — `GRADED` (a real score) or `DID` (absent). A `DID` row has no
  `componentScores`/`finalScore`; the GPA engine stamps it as an F. Only these
  two values now (extensible later; YAGNI).
- Provenance (`gradeScaleId`/`assessmentConfigId`), `isLocked`, `version`
  optimistic lock and soft-delete all carry over **per sitting row**.

**Migration.** Hand-authored `migration.sql`: add both columns with defaults
(`NORMAL`/`GRADED`), then drop & recreate the unique index to include `sitting`.
Applied on launch by the runtime migration runner (same idempotent path as the
`UserFaculty` migration). **No backfill** — every existing row is already
`NORMAL`/`GRADED` and keeps its current identity, so existing transcripts render
byte-for-byte unchanged.

**Domain entity** `ResultRecord` gains `sitting: "NORMAL" | "RESIT"` and
`status: "GRADED" | "DID"`. Repository `ResultRepository` methods that key on
`(student, course, semester)` gain a `sitting` argument; `findByStudentAndSemester`
returns all sittings.

---

## 3. GPA rule (effective attempt + discounting)

`GpaEngine` gains a per-course **effective-attempt selection** in front of the
existing credit-weighted math (it stays pure domain — no DB/UI):

1. **Stamp every row.** Processing computes `grade`/`gradePoint`/`creditsEarned`
   for _all_ sitting rows (so both display on the transcript). A `DID` row is
   stamped as an F (configured fail grade, `gradePoint = 0`, `creditsEarned = 0`).
2. **Pick the effective attempt per `(course, semester)`.** Group the semester's
   rows by `courseId`: if a `RESIT` row exists it is **effective** and the
   `NORMAL` row is **discounted** (retained for the transcript, excluded from all
   GPA arithmetic); otherwise the `NORMAL` row is effective.
3. **Aggregate only effective attempts.** A resit course contributes its credit
   to `creditsAttempted` **once** (via the effective row), never twice — this is
   how "the original F is discounted in GPA" is realised.
4. **CGPA** uses the same per-`(course, semester)` effective selection across all
   semesters; `computeCumulative` is otherwise unchanged.

**Worked example.** PHY101 — NORMAL = F (absent → DID), RESIT = C. Both rows
stamped; the semester GPA counts PHY101 once as C; the transcript prints `F` and
`C*`.

**Edge cases:** a still-failing resit (`F*`) → effective = resit F (counts as F);
a DID with no resit yet → effective = the DID-as-F. **Out of scope for v1:**
carryover/retake of a course in a _later_ session's resit (not the same
semester's resit session) — noted as future work.

---

## 4. Transcript rendering (dual entry, `*`, legend)

`BuildReportData` + the PDF/DOCX renderers change as follows:

1. **Dual entry** — both sitting rows for a course appear in the semester's
   course table, ordered **NORMAL then RESIT** so they read as a pair. No more
   dedupe-by-course.
2. **The `*` is a rendering concern.** `ReportCourse` gains `afterResit: boolean`
   (true when `sitting = RESIT`). `BuildReportData` sets it; the renderer appends
   `*` to the grade. The data layer never bakes `"C*"` into a string.
3. **DID needs no special transcript treatment** — an unresolved DID renders as
   the failing grade `F`. (Printing literal "DID" later is a one-line render
   change.)
4. **Conditional legend.** When a transcript contains ≥1 resit row, append
   **"\* Mark obtained after Resit"** to the footer. `ReportData` carries
   `legendNotes: string[]`, populated only when needed; a no-resit transcript is
   unaffected.
5. **Per-semester GPA & credits** come from §3's effective aggregation, so a
   course's credit is counted once even though two rows are printed.

**Tests:** a resit course yields two rows; the resit row carries `afterResit`;
the legend appears exactly once; a no-resit transcript is identical to today's.

---

## 5. Course-roster entry grid (+ per-student corrections)

A new **batch entry mode** on the Results screen; per-student mode is retained
for corrections and gains the same sitting selector.

- **Selectors (cascading, faculty-scoped):** Year (session) → Semester →
  Department → Programme → Course → **Sitting** (Normal | Resit). Constrained by
  Workstream A's faculty scoping — a Faculty Officer only sees their faculties.
- **Roster derivation:** students whose **programme + level match the course**
  (`Course.programmeId`/`levelId`) and who are `ACTIVE`, within faculty scope.
  v1 uses current placement; strict per-session rostering via `StudentEnrollment`
  is a noted refinement.
- **Grid columns:** one numeric column per active `AssessmentStructure`
  component (e.g. CA, Exam), plus Matric, Name, a live final-score preview, and a
  per-row **DID** toggle (sets `status = DID`, disables score cells).
- **Resit mode** filters the roster to **only students with a failing or DID
  NORMAL result** for that course+semester (resit-eligible) and writes `RESIT`
  rows; Normal mode writes `NORMAL` rows.
- **Save = one atomic batch.** A new `SaveCourseResults` application service
  takes `(semesterId, courseId, sitting, rows[])` and validates + upserts every
  row in a single transaction (all-or-nothing, like `ImportResults`), keyed on
  `(student, course, semester, sitting)`. It reuses the scoring/validation core
  of `EnterResult`/`ImportResults` rather than duplicating it.
- **Locking:** a locked NORMAL grid is read-only; the RESIT grid stays editable
  (new, unlocked rows) — this is what lets the resit session be entered after the
  normal session is finalised.

---

## 6. Processing & locking across sittings

Today `ProcessSemester` errors if any result is locked (AD9.3) and finalises the
whole semester at once — which would make resits impossible after the normal
session. The fix:

1. **Lock granularity = per sitting.** A lock applies to
   `(student, semester, sitting)`. `LockSemesterResults` takes an explicit
   `sitting`. NORMAL can be finalised while RESIT stays open.
2. **Processing recomputes only _unlocked_ rows; locked rows are finalised
   inputs.** AD9.3 relaxes from "error if anything is locked" to "**never mutate
   a locked row**." Processing re-stamps unlocked rows, reads locked rows as-is,
   and computes the GPA summary from the effective attempts across **both**
   sittings. Re-opening a finalised row still requires the audited `UnlockResult`
   (or an admin override — §7).
3. **Lifecycle:** enter & process NORMAL → stamp grades, produce GPA → lock
   NORMAL. Later, in the resit session, enter RESIT rows → process again: the
   locked NORMAL F is untouched but discounted, the RESIT grade becomes effective
   → the semester GPA reflects the resit → lock RESIT.
4. **Effective-attempt selection spans locked + new rows**, so finalising NORMAL
   first never blocks the resit from overriding it in GPA.
5. **Shape stays per-student.** `ProcessSemester` remains a per-student-semester
   operation. The grid adds a convenience **"Process & lock all rostered
   students"** that loops the per-student use-case (atomic per student).
6. **Audit.** `PROCESS_SEMESTER`, `LOCK`, `UNLOCK` entries record the `sitting`.

---

## 7. Admin override (cross-cutting)

For administrative flexibility, a privileged operator may bypass the
**academic-process** restrictions. Modelled as a runtime-assignable permission
**`results.override`**, seeded onto `SUPER_ADMIN` and grantable to others through
the existing editable RBAC (not a hardcoded role check).

When the acting session holds `results.override`, the results use-cases relax:

1. **Lock bypass** — write/edit a locked result in place; no separate
   `UnlockResult` step.
2. **Resit-eligibility bypass** — enter a `RESIT` row for any student, even
   without a prior failing/DID NORMAL attempt.
3. **Roster bypass** — add a result for a student outside the derived roster.
4. **Re-process locked** — `ProcessSemester` may recompute and re-stamp even
   locked rows.

**Hard boundary — not overridable:** institution **tenant isolation** (that is
security, not an academic rule). Faculty scope still applies unless the operator
is institution-wide.

**Auditing:** every override path records an audit entry with an explicit
`override: true` marker and a reason string, so the paper trail shows that an
admin bypassed a rule and why. Override is checked in the application use-cases
(the same fail-closed seam as permissions), never in the UI alone.

---

## 8. Layering, security & testing

- **Clean Architecture preserved.** `GpaEngine` and the effective-attempt rule
  stay pure domain (no Prisma/React). `SaveCourseResults`, `ProcessSemester`,
  `EnterResult` are application use-cases depending on repository interfaces.
  Screens call them via the core; never touch the DB.
- **Runtime-configured, not hardcoded.** Sittings/statuses are guarded by a
  domain value-object; grade scales and assessment structures remain the existing
  runtime config; `results.override` is an RBAC permission, not a role literal.
- **Faculty scoping** reuses Workstream A (`scopeStudentWhere` /
  `requireInFacultyScope`) on the roster and per-student paths.
- **Tests (Vitest):** GPA effective-attempt selection & discounting (incl. DID-as-F,
  F\*, no-resit); migration upgrade (columns + new unique key, idempotent);
  `SaveCourseResults` atomic batch + resit-eligibility filter; transcript dual
  entry + `afterResit` + conditional legend + no-resit-unchanged; sitting-level
  lock/process lifecycle; admin-override bypass paths each audited. UI: roster
  grid cascade + DID toggle + resit-mode filtering; per-student sitting selector.

## 9. Definition of done

- [ ] Schema + migration (two columns, new unique key) applied & client regen.
- [ ] Domain/repository: `ResultRecord` fields, `sitting`-aware repo methods,
      sitting value-object.
- [ ] `GpaEngine` effective-attempt selection + discounting; CGPA via same.
- [ ] `SaveCourseResults` use-case; `EnterResult`/`ProcessSemester`/
      `LockSemesterResults` sitting- & override-aware.
- [ ] `results.override` permission seeded (idempotent) on `SUPER_ADMIN`.
- [ ] Transcript dual entry + asterisk + conditional legend.
- [ ] UI: roster grid (cascade, DID toggle, resit filter, batch save/process) +
      per-student sitting selector; host/contract/ipc/zod wiring.
- [ ] Tests green; `tsc` strict + lint + boundary fitness clean.
- [ ] `/docs` updated; summary posted.

## 10. Out of scope (future work)

- Carryover/retake of a course in a **later** session's resit (cross-semester
  attempts). v1 handles the same semester's resit session only.
- Strict per-session rostering via `StudentEnrollment` history (v1 uses current
  placement).
- Additional result statuses (e.g. DISQUALIFIED/INCOMPLETE) beyond GRADED/DID.
