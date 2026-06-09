# Security Architecture

**Project:** EARTMP · **Phase:** 0 · **Status:** Draft, awaiting approval

> **⚠ Post-review revisions (2026-06-08) — see
> [architecture-review.md](architecture-review.md).** The critical review
> **upgrades** several items here from "future/optional" to launch requirements:
> (1) **encrypt the primary DB at rest**, not just backups (F-12) — currently
> only backups are encrypted; (2) a **mandatory fail-closed authorization seam**
> around every use-case, not per-use-case discipline (F-13); (3) **digital-
> signature** transcript verification (institution private key), not a self-
> referential hash (F-14); (4) **hash-chained audit log** promoted to launch
> (F-15); (5) Tauri IPC must **derive identity from the core session**, never from
> webview arguments (F-16). F-12 and F-14 are decisions pending your input.

EARTMP holds **permanent academic records** — a high-integrity, high-
confidentiality asset. This document defines authentication, authorization
(RBAC), record locking, audit logging, backup/encryption, and the desktop
threat model. It complements [solution-architecture.md](solution-architecture.md)
§6 and the auth/RBAC tables in [database-design.md](database-design.md).

---

## 1. Security objectives (CIA mapped to assets)

| Asset                    | Confidentiality        | Integrity                                       | Availability               |
| ------------------------ | ---------------------- | ----------------------------------------------- | -------------------------- |
| Student records, results | PII — restrict by role | **Highest** — wrong/altered grades unacceptable | offline-first, backups     |
| Transcripts              | issued documents       | snapshot + hash; tamper-evident                 | reproducible from snapshot |
| Credentials              | Argon2 hashes only     | no plaintext ever                               | —                          |
| Audit log                | role-restricted        | **append-only, immutable**                      | durable                    |
| Backups                  | encrypted at rest      | integrity-checked                               | USB/offsite copy           |

---

## 2. Authentication

- **Local accounts** in the `User` table; `passwordHash` stores an **Argon2id**
  hash (memory-hard, salted, current best practice). Plaintext passwords are
  never stored, logged, or sent over IPC after hashing.
- **Hashing port.** A `HashingPort` (application port) with an Argon2
  implementation in `infrastructure/crypto`. Cost parameters (memory, iterations,
  parallelism) are tuned for desktop CPUs and stored as configuration so they can
  be raised over time. `[ASSUMPTION]` default: Argon2id, 19 MiB, t=2, p=1 —
  confirm/raise after benchmarking.
- **Login flow:** username → fetch user (active, not soft-deleted) → verify hash
  → on success update `lastLoginAt`, open a session, write `AuditLog{action:
LOGIN}`. On failure, generic error (no user-enumeration), rate-limit attempts.
- **Password policy** (configurable via `Setting`): min length, complexity,
  optional rotation. `[ASSUMPTION]` defaults TBD.
- **Session model:** in-process session for the single desktop operator; auto-
  lock after configurable idle timeout requiring re-auth. No network tokens
  (offline-first).

---

## 3. Authorization — RBAC

- **Model:** `User` → one `Role` → many `Permission` via `RolePermission`.
  Permissions are fine-grained keys (`students.create`, `results.import`,
  `results.unlock`, `transcripts.approve`, `config.gradescale.edit`,
  `backup.restore`, `audit.read`, …).
- **Enforcement point:** the **use-case boundary** (application layer). Every
  use-case declares the permission(s) it requires; an authorization guard checks
  the current user's effective permissions before `execute()` runs. The UI
  _also_ hides/disables unauthorized actions, but the use-case is the
  authoritative gate (defence in depth — UI checks are cosmetic).
- **Seeded roles** `[ASSUMPTION]`: `SUPER_ADMIN` (all), `REGISTRAR` (records +
  transcripts + approve), `DATA_ENTRY` (enter/import results, no approve/unlock),
  `VIEWER` (read-only). Confirm against the real SDP.
- **Least privilege & separation of duties:** the role that _enters_ results
  should not be the role that _approves/locks_ transcripts. Encoded by splitting
  `results.*` and `transcripts.approve`/`results.unlock` permissions.

---

## 4. Record locking & data integrity

- **`Result.isLocked`** — once results are processed/approved, the result is
  locked. A locked result is immutable except through an explicit, permission-
  gated (`results.unlock`) **unlock workflow** that writes a before/after
  `AuditLog` entry.
- **`Transcript.status`** (`DRAFT → APPROVED → LOCKED`) — only `DRAFT` is
  editable (`TranscriptRules.isEditable`); only `APPROVED`/`LOCKED` may be
  exported (`TranscriptRules.canExport`). This prevents issuing an unreviewed
  transcript and prevents editing an issued one.
- **Snapshot immutability:** `Transcript.snapshot` freezes the rendered data at
  generation; `verificationHash` is computed over the snapshot so any later
  change to underlying records does not silently alter an already-issued
  transcript, and tampering with a stored transcript is detectable.
- **Optimistic concurrency:** `updatedAt` guards concurrent edits (reject a write
  whose base `updatedAt` is stale) — relevant if v1 ever runs multi-user.

---

## 5. Audit logging

- **Append-only `AuditLog`** — no `updatedAt`/`deletedAt`; modelled as an
  `AuditLogPort` (not a CRUD repository) so application code _cannot_ update or
  delete entries.
- **What is logged:** every state-changing use-case records `{userId, action,
entity, recordId, oldValue, newValue, ipAddress?, createdAt}`. Actions include
  `CREATE/UPDATE/DELETE/LOGIN/EXPORT/PROCESS_SEMESTER/UNLOCK/APPROVE/RESTORE`.
- **Mechanism:** an audit interceptor/decorator around write use-cases captures
  before/after states (`oldValue`/`newValue` as JSON) so the log is a complete
  change history. Read-only operations are not logged except sensitive exports.
- **Tamper-evidence (future hardening):** optionally chain entries with a hash of
  the previous row to make deletion/reordering detectable. `[ASSUMPTION]` —
  decide in a later phase.

---

## 6. Backup, recovery & encryption

- **Backup model (`Backup` table):** `MANUAL`/`AUTOMATIC`/`SCHEDULED`
  (`DAILY`/`WEEKLY`/`MONTHLY`), compressed by default, with `filePath`,
  `sizeBytes`, timestamp.
- **Mechanism:** consistent SQLite copy (use SQLite Online Backup API / `VACUUM
INTO`, not a raw file copy mid-write), then **compress** and **encrypt** at
  rest (AES-256-GCM). USB/offsite export supported for offline durability.
- **Encryption key management** (R-7): the backup key is derived from an operator
  passphrase (Argon2id KDF) and **never stored in plaintext beside the backup**.
  Losing the passphrase means the backup is unrecoverable — surface this clearly
  in the UI. `[DECISION NEEDED]` key-escrow policy.
- **Restore:** permission-gated (`backup.restore`), integrity-checked (verify
  GCM tag / checksum), and audited. Restore into a staging DB first, validate,
  then swap.
- **Recovery objectives** `[ASSUMPTION]`: RPO ≤ last scheduled backup; RTO =
  minutes (single-file restore). Confirm institutional requirements.

---

## 7. Input & data validation (security-relevant)

- **Defence in depth:** Zod at the UI/IPC edge → domain value-object invariants →
  DB constraints. Untrusted spreadsheet imports are fully validated (existence,
  range, duplicates) before any write, with an error report and no partial
  commits outside a transaction.
- **Injection:** Prisma parameterises all queries; no string-built SQL. Any raw
  SQL (e.g. partial unique indexes) is static, not user-derived.
- **File handling:** imported files size-limited and parsed defensively (SheetJS);
  generated files written to controlled app paths only.

---

## 8. Desktop threat model

| Threat                                         | Surface                | Mitigation                                                                                                          |
| ---------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Stolen device                                  | local SQLite + backups | OS disk encryption recommended; encrypted backups; idle auto-lock.                                                  |
| Malicious/curious operator                     | RBAC scope             | least privilege, separation of duties, full audit trail.                                                            |
| Tampering with the DB file directly            | offline app            | record locks + transcript hashes make tampering detectable; audit chain (future).                                   |
| Tampered transcript presented to a third party | issued PDF             | QR verification hash compared against stored snapshot (see [reporting-architecture.md](reporting-architecture.md)). |
| Credential theft                               | `User.passwordHash`    | Argon2id, salted; no plaintext; rate-limited login.                                                                 |
| Tauri IPC abuse                                | webview → core         | minimal, typed command surface; no arbitrary FS/shell exposed to the webview; validate every command input.         |
| Supply chain                                   | npm/cargo deps         | pinned lockfiles, dependency review; out-of-scope deps avoided.                                                     |

> Tauri's capability/allowlist model: expose only the specific commands the UI
> needs; do not enable broad FS/shell/HTTP scopes. The webview is treated as
> untrusted relative to the Rust core.

---

## 9. Privacy

- Student PII (name, DOB, contact, photo) is access-controlled by role and never
  leaves the device except via operator-initiated, audited exports/backups.
- Exports/transcripts contain only the fields the template defines; no hidden
  PII leakage.

---

## 10. Open items for spec reconciliation

- `[ASSUMPTION]` Concrete role/permission catalogue (§3).
- `[ASSUMPTION]` Password & session policy defaults (§2).
- `[DECISION NEEDED]` Backup key-escrow and Argon2 cost params (§2, §6).
- `[ASSUMPTION]` Whether audit-chain tamper-evidence is required at launch (§5).

_Related: [solution-architecture.md](solution-architecture.md) ·
[database-design.md](database-design.md) ·
[reporting-architecture.md](reporting-architecture.md)_
