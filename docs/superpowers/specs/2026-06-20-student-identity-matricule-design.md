# Student identity — admission session & matricule template (Workstream C)

**Date:** 2026-06-20
**Status:** Approved (pending final spec review)
**Scope:** Items 1 & 4 of the records upgrade set — configure the **admission
session per student** (all scenarios), and a **template-built matricule** with
manual override. Builds on the existing `Student`/`StudentEnrollment`/settings
model and the faculty scoping shipped in Workstream A.

---

## 1. Decisions captured

- **Matricule tokens:** the template may use `{institutionCode}` (`Institution.code`),
  `{faculty}`/`{dept}` (`Faculty.code`/`Department.code`), `{year}`/`{year2}`
  (admission year 4-/2-digit), `{seq}`/`{seq:0000}` (zero-padded running number),
  and any literal text/separators. **No** programme/level tokens.
- **Sequence reset scope:** per **faculty, per admission year**. Counter key
  `(institutionId, facultyId, year)`; a new key starts at 1.
- **Admission session = immutable intake identity.** Set once at admission to the
  session the student joined (selectable, can back-date); drives the matricule
  year; unchanged by transfer or level progression (enrollment tracks those);
  re-admission keeps the original admission session + matricule; admin-correctable.
- **Generation UX:** auto by default with a live preview; manual override allowed;
  a manual matricule does **not** consume the counter. Both validated unique.
- **Structural approach (A):** a dedicated atomic `MatriculeCounter` table.
  Rejected: deriving `max(seq)+1` from existing students (fragile, race-prone);
  counters in a Settings JSON blob (read-modify-write isn't atomic).

---

## 2. Data model & config

### `MatriculeCounter` (new Prisma model)

```prisma
model MatriculeCounter {
  id            String   @id @default(cuid())
  institutionId String?            // tenant scope (denormalized, matches the codebase pattern)
  facultyId     String
  year          Int                // admission year, e.g. 2025
  next          Int      @default(1)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@unique([institutionId, facultyId, year])
}
```

The `@@unique` key **is** the reset scope. Reserving a number is
"ensure-row-then-increment-and-return" run **inside the AdmitStudent / import
transaction**, serialized by the transaction + unique constraint.

### Config — one new setting

`student.matriculeRule` (a template string), added to `SETTING_KEYS` and
`SettingsRegistry` alongside `transcriptNumberRule`. Example:
`"{institutionCode}{faculty}{year2}-{seq:0000}"` → `"UBFS25-0042"`. Ships with a
sensible default. The registry **validates** the template at `SetSetting` time:
only the §1 tokens (plus literals) are allowed; an unknown `{token}` is rejected.

### No other schema change

- `Student.admissionSession` **already exists** (nullable string) — we start
  populating it. `Student.facultyId`/`departmentId` already exist — admission now
  sets them (see §3).
- `Faculty.code`/`Department.code` supply `{faculty}`/`{dept}`. A referenced unit
  with no `code` is a clear field error, never a blank token.
- Matricule uniqueness is already enforced by the live **partial-unique index**
  on `matricNumber` (`WHERE deletedAt IS NULL`); auto and manual values both pass
  `findByMatric`.
- `StudentEnrollment` is unchanged — `admissionSession` (intake) and `fromSession`
  (placement) stay distinct.

---

## 3. Matricule generator service

Two cleanly split layers:

- **`expandMatricule(template, tokens)`** — **pure domain**, no I/O (sibling of the
  existing `expandNumberRule`/`TranscriptNumber`). Substitutes resolved token
  values; `{seq:0000}` padding follows the transcript-number convention. Reused by
  both preview and commit.
- **`GenerateMatricule` (application service)** — resolves `institutionCode` /
  `faculty` / `dept` / `year` from the student's context, **reserves** the next
  sequence from `MatriculeCounter` inside the caller's `UnitOfWork`, and expands.
  The admission **year is parsed from `admissionSession`** (`"2025/2026"` → `2025`,
  `{year2}` = `25`); a non-parseable session is a validation error.

**Counter reservation** — `reserveNext(institutionId, facultyId, year)`: ensure
the row exists, atomically `next += 1`, return the value just consumed.

**Two modes:**

- **peek** (no increment) — backs the UI live-preview (the _likely_ next number).
- **reserve** (increment) — runs at admission inside the student-insert
  transaction; its value is **authoritative**. The preview is indicative; the
  committed matricule is whatever the transaction reserves (correct under
  concurrent admits).

**Manual override** never calls `GenerateMatricule` — the counter is untouched.

---

## 4. Admission flow & scenarios

### `AdmitStudent` changes

- Input: `admissionSession` **required**; `matricNumber` **optional** (auto when
  omitted); `facultyId` + `departmentId` captured (the admit cascade already
  collects them).
- In one transaction: manual `matricNumber` → validate + uniqueness-check and use;
  else `GenerateMatricule(reserve)` keyed on `facultyId` + the admission year.
  Create the student with `admissionSession`, `matricNumber`, and the denormalized
  `facultyId`/`departmentId`; open the initial enrollment (`fromSession =
admissionSession`).
- **Latent bug fixed:** today `AdmitStudent` sets neither `facultyId` nor
  `departmentId`, so newly admitted students are invisible to Workstream-A
  faculty-scoped officers. Setting them here closes that gap.

### Scenarios (one flow handles all)

- **Regular intake** — `admissionSession` = current session; matricule auto.
- **Transfer-in at a higher level** — admit with `levelId` = 200/300 and
  `admissionSession` = the join session; matricule year reflects the join;
  enrollment starts at that level. No special case (`AdmitStudent` already takes
  `levelId`).
- **Deferred / mid-year / back-dated** — `admissionSession` freely selectable
  (incl. a past session); year and the `(faculty, year)` counter follow from it.

### Re-admission

A withdrawn student keeps their matricule + admission session, so this is **not**
a new `AdmitStudent`. A new **`ReadmitStudent`** use-case (gated, audited)
transitions `WITHDRAWN → ACTIVE` and opens a fresh enrollment (possibly new
programme/level/session via the existing `EnrollStudent`), leaving `matricNumber`
and `admissionSession` untouched. This adds a `WITHDRAWN → ACTIVE` transition for
this path only. (Re-admitting a **graduate** into a new programme is a new
admission with a new matricule — out of scope here.)

### Immutability & correction

Once issued, the matricule is independent of later edits. `admissionSession` is
set at admission; an admin correction via `UpdateStudent` is allowed and audited
but does **not** retro-rewrite an already-issued matricule.

---

## 5. Import flow

`ImportStudents` already applies batch-level `facultyId`/`departmentId`/
`programmeId`/`levelId`/`admissionSession` and runs as one all-or-nothing
transaction. Changes:

- **Per-row matricule, auto or manual.** A row supplying `matricNumber` uses it
  (validated unique); a row omitting it is generated from the template, reserving
  the next `(faculty, year)` number in row order. A file may mix both. The
  in-batch duplicate check covers supplied **and** generated values.
- **Counter + transaction.** The N reservations run in the existing import
  transaction; a validation rollback rolls back the counter too — no burned
  numbers.
- **Admission session.** Batch `admissionSession` applies to all rows (and is the
  matricule-year source); an optional per-row `admissionSession` column overrides
  it for mixed-cohort files. An unparseable year is a row-level error.
- **Faculty stays batch-level (v1).** The `{faculty}` token + counter scope use
  the batch `facultyId`; multi-faculty files mean separate imports. Deliberate v1
  boundary.
- Import also reliably sets the denormalized `facultyId`/`departmentId` (same
  scoping fix as admission).
- The validation report gains clear per-row messages for the new failure modes
  (missing/unparseable admission session; referenced faculty/dept lacking a `code`).

---

## 6. UI

### Admit form (`StudentsScreen` AdmitModal)

- The session dropdown becomes the explicit **Admission session** (immutable
  intake), same `listSessions` source.
- **Matricule, auto by default:** a live **preview** via a non-consuming
  `previewMatricule({ facultyId, admissionSession })`, updating as faculty/session
  change. A **"Enter manually"** toggle swaps to a text input (preview hidden). On
  submit, auto omits `matricNumber` (server reserves + returns the authoritative
  value); manual sends the typed one. The **issued matricule is shown on success**.
  If no template is configured, auto shows a hint and the operator uses manual.

### Configuration screen

A **matricule template editor**: a text input bound to `student.matriculeRule`, a
**live sample** (`{faculty}`=sample code, `{year}`=current, `{seq}`=1) and a token
legend. Saved via the existing `setSetting`; unknown-token errors render inline.
Sits beside the transcript-number rule config.

### Re-admission

A **"Readmit"** action on a withdrawn student opens a modal to choose the new
programme/level/session; `matricNumber` + `admissionSession` shown read-only.
Gated by permission; calls `readmitStudent({ studentId, programmeId, levelId,
fromSession })`.

### Contract additions

`previewMatricule`, `readmitStudent`, and the extended `admitStudent` input
(`admissionSession` + optional `matricNumber` + `facultyId`/`departmentId`) — all
faculty-scoped and Zod-validated at the host seam, per the Workstream A/B pattern.

---

## 7. Layering, security & testing

- **Layering.** `expandMatricule` pure domain; `GenerateMatricule` an application
  service inside the caller's `UnitOfWork`; `MatriculeCounter` a new repo
  port + Prisma adapter; the template is a `SettingsRegistry` entry.
  `AdmitStudent`/`ImportStudents`/`ReadmitStudent` are use-cases; UI via the core.
- **Security.** `admitStudent`/`readmitStudent`/import gated by existing
  `students.*` permissions **and** Workstream-A faculty scope
  (`requireInFacultyScope(facultyId)` — an officer admits only into their
  faculties and advances only their counters). `setSetting("student.matriculeRule")`
  gated by `settings.manage`. Atomic counter (transaction + `@@unique`); manual
  matricules hit the live partial-unique index.
- **Tests (Vitest):** `expandMatricule` (padding, `{year2}`, literals,
  unknown-token rejection); `GenerateMatricule` (reserve increments, peek doesn't,
  per-`(faculty,year)` reset, year parsed from session, missing-`code` error);
  `AdmitStudent` (auto sets matricule + admissionSession + denormalized
  faculty/dept; manual skips counter; faculty-scope guard); `ImportStudents`
  (mixed manual/auto, per-row session, rollback doesn't burn the counter);
  `ReadmitStudent` (WITHDRAWN→ACTIVE + new enrollment, identity retained); settings
  validation; migration (table created, idempotent); UI (preview + manual toggle +
  issued value, template editor live sample, readmit modal); boundary fitness
  (expander stays pure).

## 8. Definition of done

- [ ] `MatriculeCounter` model + migration (applied, idempotent) + client regen.
- [ ] `student.matriculeRule` setting in `SETTING_KEYS`/registry with token validation + default.
- [ ] `expandMatricule` (pure) + `GenerateMatricule` (peek/reserve) + counter repo port & Prisma impl.
- [ ] `AdmitStudent`: required `admissionSession`, optional/auto `matricNumber`, sets denormalized `facultyId`/`departmentId`; faculty-scope guard.
- [ ] `ImportStudents`: per-row auto/manual matricule, per-row admission session, rollback-safe counter.
- [ ] `ReadmitStudent` use-case (WITHDRAWN→ACTIVE + new enrollment, identity retained).
- [ ] Contract/host/ipc/zod: `previewMatricule`, `readmitStudent`, extended `admitStudent`.
- [ ] UI: admit preview + manual toggle + issued value; config template editor; readmit modal.
- [ ] Tests green; `tsc` strict + lint + boundary fitness clean.
- [ ] `/docs` updated; summary posted.

## 9. Out of scope (future work)

- Per-row multi-faculty import (faculty stays batch-level).
- Re-admitting a **graduate** into a new programme (treated as a new admission).
- Matricule check-digits or format validation beyond the template tokens.
- Retroactively rewriting an issued matricule when `admissionSession` is corrected.
