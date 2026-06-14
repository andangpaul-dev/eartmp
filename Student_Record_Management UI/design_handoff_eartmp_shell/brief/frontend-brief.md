# EARTMP — Frontend Design Brief

A complete, self-contained brief for designing the **EduCore Academic Records &
Transcript Management Platform (EARTMP)** frontend. Hand this to a design tool;
everything below maps to a real, already-built backend capability — so the UI you
design has a working core behind it.

---

## 1. Product in one paragraph

EARTMP is an **offline-first desktop application** for a university registry. A
small team of staff use it to manage students, process exam results into
GPA/CGPA, generate **digitally-signed, tamper-evident transcripts**, clear
students for graduation, back up the database, and review a tamper-evident audit
trail. It runs **locally** (no server, no internet required) on a single machine
per office. The tone is **serious, trustworthy, and efficient** — this is a system
of record for legal documents, not a consumer app. Think "government registry
software, but modern and pleasant to use."

## 2. Platform & tech constraints

- **Desktop app:** Tauri 2 (a Rust shell hosting a web UI) + **React 19 +
  TypeScript**. Design for a **resizable desktop window** (min ~1024×680), not
  mobile. Mouse + keyboard; power users will want keyboard shortcuts.
- **Offline-first:** all data is local (SQLite). No network spinners, no "syncing"
  — but operations like importing 100k results or generating a PDF can take a
  second or two, so design **progress/busy states**.
- **Print/export matters:** transcripts export to **PDF and DOCX**; the UI should
  feel print-aware (A4, document previews).
- **Security is visible:** the app is **locked behind a login**, and signing the
  transcript key requires an **operator passphrase** — design for an unlock/secret
  prompt pattern.

## 3. Users & roles (RBAC — design permission-aware UI)

Every action is **permission-gated and fail-closed**: if a user lacks a
permission, the control should be **hidden or disabled with a reason**, never
shown-then-error. Four seeded roles:

| Role            | Who               | Can do                                                                          |
| --------------- | ----------------- | ------------------------------------------------------------------------------- |
| **SUPER_ADMIN** | IT / system owner | Everything: users, roles, config, security, backup, audit                       |
| **REGISTRAR**   | Head of records   | Students, results, transcripts (generate/approve), templates, graduation, audit |
| **DATA_ENTRY**  | Clerks            | Enter/import results, view students/courses (no approvals)                      |
| **VIEWER**      | Auditor/read-only | View students + the audit log                                                   |

Permission keys the UI checks (examples): `students.create`, `results.process`,
`results.unlock`, `transcripts.generate`, `transcripts.approve`,
`templates.manage`, `graduation.clear`, `backup.create`, `backup.restore`,
`security.manage`, `audit.read`, `config.manage`, `users.create`.

**Design implication:** a single screen looks different per role. Build components
that accept a `can("permission")` check and degrade gracefully.

## 4. Information architecture (suggested navigation)

A persistent **left sidebar** (the app is task-dense) + a top bar (current user,
institution name/logo, lock button, global search). Suggested groups:

- **Dashboard**
- **Students** (records, admission, enrollment)
- **Results** (entry, processing, import)
- **Transcripts** (academic summary, generate, verify, templates)
- **Graduation** (eligibility, clearance)
- **Configuration** (grading, assessment, standing, institution, settings)
- **Administration** (users & roles, security, backup, audit) — admin-only

Hide whole groups the role can't use.

---

## 5. Screen inventory (each maps to a real backend use-case)

For every screen: **purpose · key data shown · primary actions · states/edge
cases · who**.

### 5.1 Auth & session

- **Login** — username + password. · Error: invalid credentials (generic, no
  user-enumeration). First-login banner: "Change the default password." · Everyone.
- **Change password** — old + new + confirm; password policy shown (min length,
  number, uppercase) and validated live. · Everyone.
- **Unlock / operator passphrase** — a modal/screen to enter the **key passphrase**
  used to sign transcripts and encrypt backups. Pattern: prompt once per
  session/sensitive action. **Warn clearly: a lost passphrase is unrecoverable.**

### 5.2 Dashboard

- At-a-glance: counts (active students, results pending processing, transcripts in
  DRAFT, last backup date, **audit-integrity badge** = "Verified ✓" / "Broken ✗").
  Quick actions gated by role. · Everyone (content varies).

### 5.3 Students

- **Student list** — paginated, **filterable** (department, programme, level,
  status, search by name/matric). Columns: matric, name, programme, level, status
  badge. · States: empty, loading, large lists (virtualize). · `students.read`.
- **Admit student** — form: matric number, full name, reg number?, programme,
  level, entry session. Creating a student also creates their **enrollment**
  atomically. · Validation: duplicate matric rejected. · `students.create`.
- **Student profile** — details, **enrollment history**, status with an allowed
  **status-transition** control (ACTIVE → SUSPENDED/DEFERRED/WITHDRAWN/GRADUATED;
  terminal states have no further transitions — disable invalid ones), and their
  results/academic summary. · `students.read` (+ `students.update` to edit).

### 5.4 Results

- **Result entry** — pick student + course + semester; enter **component scores**
  (e.g. CA + Exam) per the configured assessment structure; the **final score is
  computed live**. Re-entry updates, never duplicates. · Edge: a **locked** result
  is read-only (show a lock + "unlock to edit"). · `results.process`.
- **Process semester** — for a student+semester: turn entered scores into grades,
  grade points, credits, and a **semester GPA**, atomically. Show a before/after
  summary; processing **locks** the results. · `results.process`.
- **Lock / Unlock** — lock a semester (immutable); unlocking a single result is a
  separate, **audited, higher-privilege** action with a confirm dialog. ·
  `results.process` / `results.unlock`.
- **Import wizard** (spreadsheet) — 3 steps: **upload** (.xlsx/.csv) → **preview &
  validation report** (per-row errors: unknown matric/course, out-of-range scores,
  duplicates) → **commit** (all-or-nothing) or **dry-run**. This is a flagship
  screen — make the error report scannable (row #, message). · `results.import`.

### 5.5 Transcripts & academic summary

- **Academic summary** (per student) — per-semester GPA table + **cumulative CGPA**
  - **standing** (e.g. First Class). Credits attempted/earned. Read-only, faithful
    to how results were processed. · `results.read`.
- **Generate transcript** — produces a **DRAFT** transcript: assembles data, binds
  it to a template, **snapshots** it, **digitally signs** it, assigns a transcript
  number. Show the number + a "DRAFT" status badge. · `transcripts.generate`.
- **Transcript list / detail** — status workflow **DRAFT → APPROVED → LOCKED**;
  **Verify** button (recomputes the signature → "Authentic ✓" / "Tampered ✗");
  **Approve** (REGISTRAR) moves DRAFT→APPROVED; **Export** to PDF or DOCX (a DRAFT
  export is allowed only as a **watermarked preview**; official export needs
  APPROVED/LOCKED). · `transcripts.read` / `.approve`.
- **Transcript preview** — an A4 document preview (header/branding, student fields,
  per-session course tables, summary, signatures, **QR code**, optional **DRAFT
  watermark**). This should look like a real transcript.

### 5.6 Template designer (transcript layouts)

- **Template list** — name, version, default badge; create/clone/set-default/delete
  (can't delete the default or an in-use template). · `templates.read`.
- **Template editor** — edit the **layout** (a block tree: title, field grid,
  session loop → course table, summary, signatures, QR). Validate before save
  (unknown block / bad data binding flagged), with a **live preview** and a
  **version bump** on save. (A structured editor or even a JSON editor + preview is
  fine for v1; the killer feature is the live preview.) · `templates.manage`.

### 5.7 Graduation

- **Eligibility check** (per student) — a **transparent report**: each requirement
  (min CGPA, min credits earned, no outstanding fails) shown as **required vs
  actual vs met ✓/✗**, with an overall Eligible/Not-eligible verdict. · `graduation.read`.
- **Clearance** — "Graduate this student" action; only enabled if eligible;
  re-checks on click; moves status to GRADUATED; audited. · `graduation.clear`.

### 5.8 Configuration (everything is runtime-config, never hardcoded)

- **Grade scales** — list; create/edit bands (mark range → grade, grade point,
  pass?); one **default**; guarded delete; **validation** (0–100, no gaps/overlaps).
- **Assessment structures** — components (key, label, weight, max score); weights
  must sum to 100; one default. · `config.manage`.
- **Academic standing bands** — label + min GPA (e.g. First Class ≥ 3.5).
- **Institution profile** — name, motto, accreditation no., **logo/seal/registrar
  signature images**, **transcript number rule** (e.g. `TR-{year}-{seq:000000}`).
- **Graduation requirements** — min CGPA, min credits, "no outstanding fails" toggle.
- **Settings** — typed/validated settings list (read = `settings.read`, edit =
  `settings.manage`).

### 5.9 Administration

- **Users & roles** — list users; create/deactivate; assign role. · `users.*` / `roles.assign`.
- **Security** — **change the key passphrase** (re-seals the signing key; old fails,
  new works); show that the signing key is **sealed/encrypted at rest**. · `security.manage`.
- **Backup & restore** — **Create backup** (downloads an encrypted file; needs the
  passphrase). **Restore** is **verify-first + destructive** → a strong, multi-step
  confirm ("this replaces all data; a tampered or wrong-passphrase backup is
  rejected with no changes"). · `backup.create` / `backup.restore`.
- **Audit log** — paginated, filterable (actor, entity, action, date range) table;
  an **integrity panel**: "Verify chain" → "Verified ✓ (N entries)" or "Broken at
  entry … (reason)". Audit rows are **append-only/immutable** — no edit/delete UI. ·
  `audit.read`.

---

## 6. Key data shapes (what the UI binds to)

These are the actual DTOs returned by the backend; design tables/forms around them.

```ts
// Pagination (lists)
Page<T> = { items: T[]; total: number }   // with skip/take query params

// Student
{ id, matricNumber, regNumber?, fullName, programmeId, levelId,
  status: "ACTIVE"|"SUSPENDED"|"DEFERRED"|"WITHDRAWN"|"GRADUATED" }

// Result (a student's course result in a semester)
{ id, studentId, courseId, semesterId,
  componentScores: { key, score }[], finalScore?, grade?, gradePoint?,
  creditsEarned?, isLocked }

// Academic summary
{ semesters: { semesterId, creditsAttempted, creditsEarned, qualityPoints, gpa }[],
  creditsAttempted, creditsEarned, cgpa, standing }

// Eligibility report
{ eligible: boolean,
  criteria: { name, required, actual, met }[] }

// Transcript
{ id, transcriptNumber, studentId, templateId, type,
  status: "DRAFT"|"APPROVED"|"LOCKED" }   // + a verify() => { valid }

// Transcript export result
{ bytes, filename, contentType }   // PDF or DOCX

// Audit entry
{ id, userId?, action, entity, recordId?, oldValue?, newValue?, createdAt,
  hash?, prevHash? }   // verify => { valid, checked, brokenAt? }

// Import report
{ totalRows, validRows, imported, errors: { row, messages: string[] }[] }
```

The **transcript document** (for the preview/renderer) is a block list:
`title | text | fieldGrid | courseTable (heading + columns + rows + footer) |
summary | remarks | signatureRow | qr`. Render it on **A4**; support a **watermark**.

---

## 7. Cross-cutting UI patterns (please be consistent)

- **Status badges** everywhere: student status, result locked, transcript
  DRAFT/APPROVED/LOCKED, audit Verified/Broken. Use color + label + icon (not color
  alone — accessibility).
- **Permission-gating:** controls the user can't use are hidden or disabled with a
  tooltip ("Requires Registrar"). Fail-closed.
- **Destructive/irreversible actions** (unlock result, delete template, **restore
  backup**, graduate, approve transcript) → **confirm dialogs** that state the
  consequence; restore needs a typed confirmation.
- **Validation:** forms validate before submit and show **field-level** errors;
  the import/template screens show **structured error reports**.
- **Empty / loading / error states** for every list and async action.
- **Audited actions** can show a subtle "this will be recorded in the audit log"
  affordance for sensitive operations.
- **Lists** are dense, sortable, paginated, filterable; large lists virtualized.
- **Document previews** (transcript) should be center-stage, paper-like, zoomable.

## 8. Domain rules the UI must respect

- A **locked** result is immutable; editing requires an explicit, audited unlock.
- A transcript can only be **officially exported when APPROVED/LOCKED**; DRAFT
  exports are watermarked previews.
- **One default** per grade scale / assessment / template; the default can't be
  deleted; an in-use template can't be deleted.
- **CGPA** is shown to 2 decimals and is an aggregate (credit-weighted) — display
  it, don't recompute it client-side.
- Transcript **verification** and **audit verification** are first-class trust
  signals — surface them prominently (a green check is the product's promise).
- **Lost passphrase = unrecoverable** signing key / backup — warn before any
  passphrase change or backup.
- Status transitions follow a matrix; only offer valid next states.

## 9. Visual / brand direction

- **Institution-branded but neutral:** the institution sets its name, logo, seal,
  and colors (configurable). Default to a calm, professional palette (deep blue /
  slate neutrals / a single accent), high-contrast, generous for data tables.
- **Document-grade typography:** clean sans for the app, a serif option for the
  transcript preview to feel official. Tabular numbers for scores/GPA.
- **Density with breathing room:** registry staff scan lots of rows; prioritize
  legible tables, sticky headers, clear primary actions, minimal chrome.
- **Print-aware:** the transcript preview should look like the printed output;
  consider a "print/export" affordance that mirrors the PDF.
- **Trust cues:** signed/verified badges, audit integrity status, "sealed key" and
  "encrypted backup" indicators — quietly reassuring, never alarmist.

## 10. Non-functional

- **Offline-first**, desktop window, keyboard-friendly (shortcuts for new student,
  search, save).
- **Accessibility:** WCAG AA contrast, focus states, screen-reader labels, no
  color-only meaning.
- **Performance:** the import flow handles tens of thousands of rows — design
  progress + cancel; virtualize big tables.
- **Localization-ready:** dates, number formats; institution data drives most
  labels.

---

## 11. Priority screens to design first (MVP)

1. **Login + unlock**
2. **Dashboard** (with the integrity/last-backup signals)
3. **Student list + admit + profile**
4. **Result entry + process semester**
5. **Academic summary** + **generate/verify/approve transcript** + **A4 preview**
6. **Import wizard** (upload → validation report → commit)
7. **Graduation eligibility**
8. **Audit log + integrity verify**

(Config, template designer, users/roles, backup/security are essential but can be
designed in a second pass.)

---

_Backend reference (for whoever wires it up later): each screen above corresponds
to an application use-case behind a port; see `docs/README.md` for the phase index
and `docs/runbook.md` for how to run the headless core. The runtime data layer is
the Tauri-SQL plugin (the UI calls use-cases; it never touches the DB directly)._
