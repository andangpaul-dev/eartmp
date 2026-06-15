# EARTMP — testing guide (UAT)

How to install and exercise the EARTMP desktop app. This is a **test build**: it
seeds sample data on first launch and the database file is not yet encrypted at
rest (see _Known limitations_).

## Install

Pick one (Windows x64):

- `src-tauri/target/release/bundle/nsis/EARTMP_0.1.0_x64-setup.exe` — NSIS
  installer (recommended; smaller, per-user).
- `src-tauri/target/release/bundle/msi/EARTMP_0.1.0_x64_en-US.msi` — MSI.

Run the installer, then launch **EARTMP** from the Start menu. First launch
provisions the database (you'll see the window load after a moment).

## Sign in

- **Username:** `admin`
- **Password:** `ChangeMe123!`

(SUPER_ADMIN — full access. Change this password during testing: Configuration →
Security → My password.)

## What's pre-loaded (so you can test immediately)

The test build seeds:

- **Structure:** Faculty of Science → Computer Science → BSc Computer Science,
  levels 100–400, session 2024/2025 with First/Second semesters.
- **Courses:** CSC101, CSC102, MTH101, GST101 (100 level, first semester).
- **Students:** Ada Lovelace (`CSC/2024/001`), Alan Turing (`CSC/2024/002`).
- Default grade scale, assessment structure (CA 30 / Exam 70), transcript
  template, institution profile, and a sealed transcript signing key.

## Guided walkthrough

1. **Dashboard** — live tiles: student count, signing-key state (Sealed), audit
   integrity (Verified · N).
2. **Students** — see the two seeded students; **Admit student** (Faculty →
   Department → Programme → Level cascade) to add another; open a profile and try
   a **status transition** (only valid targets are offered, with a confirm).
3. **Results** — pick a student, choose session **2024/2025** + **First
   Semester**, **Enter result** for a course: type CA/Exam scores and watch the
   **final score computed by the core** update live; save. With results present,
   **Process semester** (confirm → computes grades/GPA, then **locks**). Locked
   rows are read-only; **Unlock** one (audited).
4. **Import** — choose the same session/semester, upload a `.csv`/`.xlsx` with
   columns `matricNumber, courseCode, ca, exam`; **Validate** (dry run → error
   report); fix and **Commit** (all-or-nothing).
5. **Academic summary** — pick a processed student → per-semester GPA + CGPA +
   standing.
6. **Transcripts** — first **Unseal key** (passphrase below). **Generate**
   (DRAFT, signed) → **Verify** (shows "Ed25519 valid") → **Approve** → **Preview**
   (A4, watermarked DRAFT) and, once approved, **Export** the official PDF.
7. **Graduation** — pick a student → transparent criteria table (required vs.
   actual vs. met) → **Clear for graduation** (enabled only when eligible;
   irreversible, confirmed).
8. **Audit log** — filter by entity/action, page through entries, **Verify
   chain** (shows "Chain intact — N linked entries").
9. **Configuration** — Institution profile edit; Grading (view bands/components,
   set defaults); Graduation requirements; Security (change password; rotate the
   signing-key passphrase).

### Transcript signing-key passphrase

The signing key is sealed; unseal it (Transcripts screen) with the dev default:

```
eartmp-dev-passphrase
```

Rotate it under Configuration → Security for a real deployment. **A lost
passphrase is unrecoverable.**

## Known limitations (this build)

- **Database is plaintext at rest.** The encrypted-DB path (libSQL + Argon2 key)
  is implemented and tested but not yet the active connection. The signing key
  inside the DB is still sealed; the file itself isn't encrypted yet.
- **Sample data is seeded** on first launch (test switch `EARTMP_SEED_DEMO`).
  Production builds omit it.
- **Fixed host port 5179** — if another app holds it, the sidecar can't bind.
- **No academic-structure management UI** yet — structure comes from the seed.
- **Users & roles** screen is informational (RBAC is enforced; there's no
  list/create UI yet).
- Default `admin` password and signing passphrase are well-known — change both.

## Reset to a clean state

Close the app, then delete the database:

```
%APPDATA%\edu.eartmp.desktop\eartmp.db
```

Next launch re-provisions (admin + config + demo data) fresh.

## Reporting issues

Note the screen, the action, the expected vs. actual result, and any message
shown. The host log (sidecar) prints to the app's stderr if launched from a
console; otherwise describe the on-screen error banner/toast.
