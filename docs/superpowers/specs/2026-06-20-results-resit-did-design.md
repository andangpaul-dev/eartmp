# Results entry, resit sessions & DID — design (Workstream B)

**Date:** 2026-06-20
**Status:** Implemented (2026-06-20)
**Scope:** Items 2 & 3 of the records upgrade set — results entry organised
per academic year/semester → department → programme → course, resit
examinations (each semester has its own resit session), and DID (Did Not Sit)
handling on upload. Plus a cross-cutting **admin override** capability, and
(folded in during review) the three formerly-deferred items: **cross-session
carryover retakes**, **enrollment-history rostering**, and **additional result
statuses** (DISQUALIFIED, INCOMPLETE).

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
  semester, not a separate period. The resit appears under the same semester as
  the original on the transcript.
- **Cross-session carryover retake** (folded in) — a failed course may also be
  re-sat in a **later** session (carryover), not only the same semester's resit.
  An attempt of the same course in a later semester is just another `Result` row
  with the same `courseId`; `courseId` is the link, so no extra field is needed.
- **Result statuses** (folded in): `GRADED | DID | DISQUALIFIED | INCOMPLETE`.
  See the status table in §1.1.
- **Entry: both modes.** A course-roster batch grid (primary) and per-student
  entry (for corrections). Organised per year/semester → department → programme
  → course → sitting. Rosters are derived from **enrollment history** (the
  student's programme/level as of the selected session), not current placement.
- **Admin override** (added during review): a privileged operator may bypass the
  academic-process restrictions (locks, resit/retake eligibility, roster
  membership) for administrative flexibility. Tenant isolation is never
  overridable. Every override is audited.

### 1.1 Result status table

| status         | GPA treatment                         | Transcript               | Resit/retake eligible?   |
| -------------- | ------------------------------------- | ------------------------ | ------------------------ |
| `GRADED`       | its grade/point (incl. a real `F`)    | the grade                | yes if failing           |
| `DID`          | counts as **F** (attempted, 0 points) | `F`                      | yes                      |
| `DISQUALIFIED` | counts as **F** (attempted, 0 points) | `F` + `DQ` legend marker | no (override only)       |
| `INCOMPLETE`   | **excluded** until resolved (pending) | `I` (no points)          | n/a (resolve, not resit) |

`DISQUALIFIED` (exam malpractice) is a hard fail that is not resit-eligible by
default. `INCOMPLETE` (pending/deferred coursework) is omitted from all GPA math
and shows `I` until a later attempt replaces it.

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
  status   String  @default("GRADED")  // GRADED | DID | DISQUALIFIED | INCOMPLETE

  @@unique([studentId, courseId, semesterId, sitting])  // was: without sitting
  // existing indexes unchanged
}
```

- **`sitting`** — `NORMAL` (regular sitting) or `RESIT` (the semester's resit
  session). A **cross-session carryover retake** is simply another row for the
  same `courseId` in a later semester (NORMAL or RESIT sitting there); `courseId`
  links all attempts, so no extra "retake" field is needed.
- **`status`** — `GRADED | DID | DISQUALIFIED | INCOMPLETE` (see §1.1). `DID`,
  `DISQUALIFIED` and `INCOMPLETE` rows carry no `componentScores`/`finalScore`;
  the GPA engine stamps them per the status table. A domain value-object guards
  the allowed set.
- The asterisk is **derived** (not stored): a grade prints with `*` when it is a
  **re-attempt** — i.e. not the first chronological attempt of that `courseId`
  (a same-semester resit or a later-session retake). One source of truth.
- Provenance (`gradeScaleId`/`assessmentConfigId`), `isLocked`, `version`
  optimistic lock and soft-delete all carry over **per sitting row**.

**Migration.** Hand-authored `migration.sql`: add both columns with defaults
(`NORMAL`/`GRADED`), then drop & recreate the unique index to include `sitting`.
Applied on launch by the runtime migration runner (same idempotent path as the
`UserFaculty` migration). **No backfill** — every existing row is already
`NORMAL`/`GRADED` and keeps its current identity, so existing transcripts render
byte-for-byte unchanged.

**Domain entity** `ResultRecord` gains `sitting: "NORMAL" | "RESIT"` and
`status: "GRADED" | "DID" | "DISQUALIFIED" | "INCOMPLETE"`. Repository
`ResultRepository` methods that key on `(student, course, semester)` gain a
`sitting` argument; `findByStudentAndSemester` returns all sittings, and a new
read returns a student's **entire** result set (all sessions) for the global
effective-attempt selection (§3).

---

## 3. GPA rule (effective attempt + discounting)

Because carryover retakes can span sessions, effective-attempt selection is
**per `courseId` across the student's whole record**, not per-`(course,
semester)`. `GpaEngine` runs this selection in front of the existing
credit-weighted math (it stays pure domain — no DB/UI):

1. **Stamp every row.** Processing computes `grade`/`gradePoint`/`creditsEarned`
   for _all_ rows (every sitting in every semester) so they display on the
   transcript. Stamping follows the §1.1 status table: `DID`/`DISQUALIFIED` → F
   (`gradePoint = 0`, `creditsEarned = 0`); `INCOMPLETE` → no grade (pending).
2. **Order a course's attempts** by session chronology (`AcademicSession`
   start/order), then by semester `rank`, then sitting (`NORMAL` before `RESIT`).
3. **The latest attempt is effective; all earlier ones are discounted.** A
   discounted row is retained for the transcript but excluded from **all** GPA
   arithmetic — both its own semester's GPA and the CGPA — so semester GPA and
   CGPA stay mutually consistent. If the effective (latest) attempt is
   `INCOMPLETE`, the course is **excluded** (pending) until resolved.
4. **Aggregate only effective attempts.** A retaken course contributes its credit
   to `creditsAttempted` **once** (via the effective row), never per attempt —
   this is how "the original F is discounted" is realised across sessions.
5. **CGPA** uses the same global effective set; `computeCumulative` is otherwise
   unchanged.

Because discounting is global, a semester's GPA can change when a course from it
is later retaken. The transcript always recomputes the effective set from the
full record at build time (§4), so it is self-consistent; any stored per-semester
`GpaSummary` is a point-in-time snapshot, not the source of truth.

**Worked examples.**

- _Same-semester resit:_ PHY101 — NORMAL = F (DID), RESIT = C (same semester).
  Both rows stamped; GPA counts PHY101 once as C; transcript prints `F` then `C*`.
- _Cross-session carryover:_ MAT201 failed `F` in 2024/2025 S1; retaken and passed
  `B` in 2025/2026 S1. Both shown under their own sessions; the `F` is discounted
  everywhere; CGPA counts the `B`; the retake grade prints `B*`.

**Edge cases:** a still-failing re-attempt (`F*`) → effective = that F (counts as
F); a `DID` with no re-attempt yet → effective = DID-as-F; an `INCOMPLETE` latest
attempt → course excluded until resolved. **Out of scope:** a per-institution cap
on the number of retakes (unbounded for now).

---

## 4. Transcript rendering (dual entry, `*`, legend)

`BuildReportData` + the PDF/DOCX renderers change as follows:

1. **Every attempt is shown** under its own session/semester (a same-semester
   resit appears as a NORMAL-then-RESIT pair; a carryover retake appears under
   its later session). No dedupe-by-course.
2. **The `*` is a rendering concern.** `ReportCourse` gains
   `afterReattempt: boolean` (true for any attempt that is not the first
   chronological attempt of that `courseId` — §2). `BuildReportData` sets it from
   the global effective-attempt ordering; the renderer appends `*` to the grade.
   The data layer never bakes `"C*"` into a string.
3. **Status markers.** `DID` renders as `F` (no special marker — it _is_ an F).
   `DISQUALIFIED` renders as `F` plus a `DQ` marker; `INCOMPLETE` renders as `I`
   with no points. `ReportCourse` carries a small `marker?: "DQ" | "I"` for these.
4. **Conditional legend.** `ReportData` carries `legendNotes: string[]`,
   populated only with the markers actually present on the transcript: `*` →
   **"Mark obtained after Resit/Retake"**, `DQ` → **"Disqualified (malpractice)"**,
   `I` → **"Incomplete"**. A plain transcript with none of these is byte-for-byte
   unchanged from today.
5. **Per-semester GPA & credits** come from §3's global effective aggregation, so
   a course's credit is counted once across the whole record even though each
   attempt is printed under its session.

**Tests:** same-semester resit yields a pair with the resit carrying
`afterReattempt`; a cross-session retake carries `afterReattempt` under its later
session and discounts the earlier F everywhere; each marker drives exactly one
legend line; a transcript with no re-attempts/markers is identical to today's.

---

## 5. Course-roster entry grid (+ per-student corrections)

A new **batch entry mode** on the Results screen; per-student mode is retained
for corrections and gains the same sitting selector.

- **Selectors (cascading, faculty-scoped):** Year (session) → Semester →
  Department → Programme → Course → **Sitting** (Normal | Resit). Constrained by
  Workstream A's faculty scoping — a Faculty Officer only sees their faculties.
- **Roster derivation (enrollment-history):** students whose `StudentEnrollment`
  **covers the selected session** (`fromSession ≤ session ≤ toSession`, or
  `isCurrent`) with a `programmeId`/`levelId` matching the course — the placement
  held _as of that session_, so a past session rosters correctly. Within faculty
  scope. Falls back to current `Student.programmeId`/`levelId` when a student has
  no enrollment row (legacy data).
- **Grid columns:** one numeric column per active `AssessmentStructure`
  component (e.g. CA, Exam), plus Matric, Name, a live final-score preview, and a
  per-row **status** control (GRADED / DID / DISQUALIFIED / INCOMPLETE; non-graded
  choices disable the score cells).
- **Resit/carryover mode** filters the roster to **only students with an
  unresolved failing attempt** for that course (a failing `GRADED`, `DID`, or
  `DISQUALIFIED` whose latest attempt has not yet passed) and writes a `RESIT`
  row (same semester) or a NORMAL row in the later session (carryover). Normal
  mode writes `NORMAL` rows.
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
5. **Cross-session retakes never collide with a locked earlier semester** — a
   carryover is a row in a _different_ semester, so locking session 1 does not
   block entering/processing the retake in session 3. The earlier `F` stays
   locked and untouched; §3's global selection discounts it. The earlier
   semester's stored GPA snapshot becomes stale, but the transcript recomputes
   globally (§3/§4), so the issued document is always correct.
6. **Shape stays per-student.** `ProcessSemester` remains a per-student-semester
   operation. The grid adds a convenience **"Process & lock all rostered
   students"** that loops the per-student use-case (atomic per student).
7. **Audit.** `PROCESS_SEMESTER`, `LOCK`, `UNLOCK` entries record the `sitting`.

---

## 7. Admin override (cross-cutting)

For administrative flexibility, a privileged operator may bypass the
**academic-process** restrictions. Modelled as a runtime-assignable permission
**`results.override`**, seeded onto `SUPER_ADMIN` and grantable to others through
the existing editable RBAC (not a hardcoded role check).

When the acting session holds `results.override`, the results use-cases relax:

1. **Lock bypass** — write/edit a locked result in place; no separate
   `UnlockResult` step.
2. **Resit/retake-eligibility bypass** — enter a `RESIT` or carryover row for any
   student, even without a prior failing attempt, and re-sit a `DISQUALIFIED`
   course (normally not eligible).
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
- **Tests (Vitest):** GPA global effective-attempt selection & discounting (DID-as-F,
  DISQUALIFIED-as-F, INCOMPLETE-excluded, F\*, same-semester resit, cross-session
  carryover, no-reattempt unchanged); attempt ordering across sessions; migration
  upgrade (columns + new unique key, idempotent); `SaveCourseResults` atomic batch
  - resit/carryover-eligibility filter; enrollment-history roster (as-of session,
    legacy fallback); transcript per-attempt rows + `afterReattempt` + status markers
  - per-marker legend + plain-transcript-unchanged; sitting-level lock/process
    lifecycle + cross-session non-collision; admin-override bypass paths each audited.
    UI: roster grid cascade + status control + resit/carryover filtering; per-student
    sitting selector.

## 9. Definition of done

- [x] Schema + migration (two columns, new unique key) applied & client regen.
- [x] Domain/repository: `ResultRecord` `sitting`/`status` fields, sitting/status
      value-objects, `sitting`-aware repo methods, whole-record attempt reads.
- [x] `GpaEngine` **global** (per-course, cross-session) effective-attempt
      selection + discounting; CGPA + per-semester GPA via same.
- [x] Enrollment-history roster resolver (as-of session, legacy fallback).
- [x] `SaveCourseResults` use-case; `EnterResult`/`ProcessSemester`/
      `LockSemesterResults` sitting-, status- & override-aware.
- [x] `results.override` permission seeded (idempotent) on `SUPER_ADMIN`.
- [x] Transcript per-attempt rows + asterisk + status markers + conditional legend.
- [x] UI: roster grid (cascade, status control, resit/carryover filter, batch
      save/process) + per-student sitting selector; host/contract/ipc/zod wiring.
- [x] Tests green; `tsc` strict + lint + boundary fitness clean.
- [x] `/docs` updated; summary posted.

## 10. Out of scope (future work)

- A per-institution **cap on the number of retakes** (currently unbounded).
- Resit/retake **grade capping** (e.g. capped at the pass mark) — current policy
  is uncapped, dual-entry with `*`.
- Result statuses beyond `GRADED | DID | DISQUALIFIED | INCOMPLETE`.
