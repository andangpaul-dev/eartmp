# Student identity — admission session & matricule template (Workstream C)

**Date:** 2026-06-20
**Status:** Approved (pending final spec review)
**Scope:** Items 1 & 4 of the records upgrade set — configure the **admission
session per student** (all scenarios), and a **template-built matricule** with
manual override. Builds on the existing `Student`/`StudentEnrollment`/settings
model and the faculty scoping shipped in Workstream A. **Folded in during
review:** the four formerly-deferred items — **per-row multi-faculty import**,
**graduate re-admission**, **matricule check-digit + format validation**, and
**matricule regeneration on admission-session correction**.

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

### 1.1 Folded-in decisions (Section 9 brought into scope)

- **Per-row multi-faculty import.** An import row may carry its own `faculty`
  (code) column; the `{faculty}` token and counter scope then resolve **per row**,
  so a single file can span faculties. Absent a row faculty, the batch faculty
  applies. Each row's faculty must be within the operator's faculty scope.
- **Graduate re-admission.** Re-admitting a `GRADUATED` student into a new
  programme is a **fresh admission**: it creates a **new `Student` record** with a
  **new matricule + new admission session**, linked to the prior record by a new
  nullable `previousStudentId` for provenance. (Contrast with `WITHDRAWN`
  re-admission, which reuses the record and keeps the identity.) — _This new-record
  vs. same-record choice is the one judgement call; see §4._
- **Matricule check-digit + format validation.** The template gains an optional
  `{check}` token — a **Luhn (mod-10) check digit** over the decimal digits of the
  otherwise-expanded matricule. A separate optional `student.matriculeFormat`
  setting (a regex) validates **manual** matricule entries (auto values are
  trusted by construction).
- **Matricule regeneration on correction.** When an admin corrects a student's
  `admissionSession`, they may **opt in** to regenerate the matricule (reserve a
  fresh number for the corrected `(faculty, year)`); the old value is freed and the
  change is audited. Never automatic.

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

Two new settings, added to `SETTING_KEYS` and `SettingsRegistry` alongside
`transcriptNumberRule`:

- `student.matriculeRule` — the template string. Example:
  `"{institutionCode}{faculty}{year2}-{seq:0000}{check}"` → `"UBFS25-00428"`. Ships
  with a sensible default. The registry **validates** the template at `SetSetting`
  time: only the §1 tokens (plus literals) are allowed; an unknown `{token}` is
  rejected.
- `student.matriculeFormat` — an **optional** regex that **manual** matricule
  entries must match (auto values are correct by construction). Empty = no
  manual-format constraint.

### Schema change: `Student.previousStudentId`

One nullable field is added to `Student` (+ migration): `previousStudentId
String?` — links a graduate re-admission's new record to the prior one (§1.1,
§4). No FK relation required (loose id, like other provenance ids).

### Otherwise no schema change

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

**Check digit.** If the template contains `{check}`, `expandMatricule` first
expands the rest, then appends a **Luhn (mod-10) check digit** computed over the
decimal digits present in the expanded body — deterministic and pure, so preview
and commit agree.

**Format validation (manual entries).** When `student.matriculeFormat` is set, a
**manual** matricule must match that regex (validated in the use-case, surfaced as
a field error); auto-generated values are trusted by construction.

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

A new **`ReadmitStudent`** use-case (gated, audited) handles two cases by the
prior status:

- **`WITHDRAWN` → reuse identity.** Transitions `WITHDRAWN → ACTIVE` and opens a
  fresh enrollment (possibly new programme/level/session via `EnrollStudent`),
  leaving `matricNumber` and `admissionSession` **untouched**. Adds a
  `WITHDRAWN → ACTIVE` transition for this path only.
- **`GRADUATED` → fresh admission (folded in, §1.1).** Re-admitting a graduate
  into a new programme creates a **new `Student` record** (via the admission flow)
  with a **new matricule + new admission session**, copying the person's details
  and setting `previousStudentId` to the graduate record. The graduate record is
  left intact (its transcript stays valid). **Judgement call:** new-record (chosen)
  keeps each programme's matricule/transcript clean and avoids rewriting an issued
  matricule on a record that already has sealed transcripts; the alternative
  (same-record, swap matricule) would orphan prior documents. Flagged for review.

### Immutability & correction

Once issued, the matricule is independent of later edits. `admissionSession` is
set at admission; an admin correction via `UpdateStudent` is allowed and audited.
By default it does **not** rewrite the matricule, **but** (folded in, §1.1) the
correction may **opt in** to regenerate it: reserve a fresh number for the
corrected `(faculty, year)`, free the old value, and audit the change. Regeneration
is refused when the student already has issued/sealed transcripts (those reference
the old matricule) — surfaced as a clear error.

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
- **Per-row faculty (folded in, §1.1).** A row may carry a `faculty` (code)
  column; the `{faculty}` token and the `(faculty, year)` counter then resolve
  **per row**, so one file can span faculties. Absent a row faculty, the batch
  `facultyId` applies. Each row's resolved faculty must be within the operator's
  faculty scope (else a row-level error); an unknown faculty code is a row error.
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

A **"Readmit"** action on a withdrawn or graduated student opens a modal to choose
the new programme/level/session. For a **withdrawn** student, `matricNumber` +
`admissionSession` are shown read-only (retained). For a **graduate**, the modal
makes clear this is a **fresh admission** (new matricule preview + new admission
session, person details copied, linked to the prior record). Gated by permission;
calls `readmitStudent(...)`.

The student edit form's **admission-session correction** offers an opt-in
**"regenerate matricule"** checkbox (disabled, with a reason, when the student has
issued transcripts). The config **template editor** also previews the `{check}`
digit and exposes the optional `student.matriculeFormat` regex field.

### Contract additions

`previewMatricule`, `readmitStudent`, and the extended `admitStudent` input
(`admissionSession` + optional `matricNumber` + `facultyId`/`departmentId`) — all
faculty-scoped and Zod-validated at the host seam, per the Workstream A/B pattern.
`updateStudent` gains an optional `regenerateMatricule` flag.

---

## 7. Layering, security & testing

- **Layering.** `expandMatricule` pure domain; `GenerateMatricule` an application
  service inside the caller's `UnitOfWork`; `MatriculeCounter` a new repo
  port + Prisma adapter; the template is a `SettingsRegistry` entry.
  `AdmitStudent`/`ImportStudents`/`ReadmitStudent` are use-cases; UI via the core.
- **Security.** `admitStudent`/`readmitStudent`/import gated by existing
  `students.*` permissions **and** Workstream-A faculty scope
  (`requireInFacultyScope(facultyId)` — per row for multi-faculty import, so an
  officer admits only into their faculties and advances only their counters).
  `setSetting("student.matricule*")` gated by `settings.manage`. Atomic counter
  (transaction + `@@unique`); manual matricules hit the live partial-unique index.
- **Tests (Vitest):** `expandMatricule` (padding, `{year2}`, literals,
  unknown-token rejection, **`{check}` Luhn digit**); `GenerateMatricule` (reserve
  increments, peek doesn't, per-`(faculty,year)` reset, year parsed from session,
  missing-`code` error); `AdmitStudent` (auto sets matricule + admissionSession +
  denormalized faculty/dept; manual skips counter; **manual format-regex enforced**;
  faculty-scope guard); `ImportStudents` (mixed manual/auto, per-row session,
  **per-row faculty → correct counter + scope guard**, rollback doesn't burn the
  counter); `ReadmitStudent` (**WITHDRAWN** reuse-identity vs **GRADUATED** new-record
  - `previousStudentId` + new matricule); **matricule regeneration on
    admission-session correction (+ refusal when transcripts exist)**; settings
    validation (rule + format regex); migration (`MatriculeCounter` + `previousStudentId`,
    idempotent); UI (preview + manual toggle + issued value, template editor live
    sample + check + format, readmit/graduate modal, regenerate checkbox); boundary
    fitness (expander stays pure).

## 8. Definition of done

- [ ] `MatriculeCounter` model + `Student.previousStudentId` + migration (applied, idempotent) + client regen.
- [ ] `student.matriculeRule` + `student.matriculeFormat` settings in `SETTING_KEYS`/registry with token validation + defaults.
- [ ] `expandMatricule` (pure, incl. `{check}` Luhn) + `GenerateMatricule` (peek/reserve) + counter repo port & Prisma impl.
- [ ] `AdmitStudent`: required `admissionSession`, optional/auto `matricNumber`, manual format-regex check, sets denormalized `facultyId`/`departmentId`; faculty-scope guard.
- [ ] `ImportStudents`: per-row auto/manual matricule, per-row admission session, **per-row faculty + scope**, rollback-safe counter.
- [ ] `ReadmitStudent`: WITHDRAWN reuse-identity **and** GRADUATED new-record (+ `previousStudentId`, new matricule).
- [ ] Matricule regeneration on admission-session correction (opt-in, refused when transcripts exist).
- [ ] Contract/host/ipc/zod: `previewMatricule`, `readmitStudent`, extended `admitStudent`, `updateStudent.regenerateMatricule`.
- [ ] UI: admit preview + manual toggle + issued value; config template editor (+ check/format); readmit/graduate modal; regenerate checkbox.
- [ ] Tests green; `tsc` strict + lint + boundary fitness clean.
- [ ] `/docs` updated; summary posted.

## 9. Out of scope (future work)

- Matricule schemes beyond Luhn `{check}` (e.g. ISO 7064 mod-97 over alphanumerics).
- Merging/de-duplicating a person across multiple `Student` records (graduate
  re-admission links via `previousStudentId` but does not merge).
- Bulk matricule regeneration (correction-driven regeneration is per-student).
