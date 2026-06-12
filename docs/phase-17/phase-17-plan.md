# Phase 17 — Backup & Restore

**Project:** EARTMP · **Phase:** 17 · **Status:** Plan drafted, awaiting approval
to implement · **Predecessor:** Phase 16 (implemented)

> Deliverables-before-implementation spec, in the mandated format. Nothing is
> built until you approve. Logic only; the real on-disk DB-file backup is a
> Tauri-SQL shell concern (this phase builds the encrypt/verify/restore engine).
> Same proof model: headless, ≥80% coverage, dev Prisma adapter, runnable demo.

---

## Executive Summary

Phase 17 produces an **encrypted, integrity-protected backup** of the institution
data and restores it safely. A backup is a manifest + an **AES-256-GCM** ciphertext
whose key is derived from the **operator passphrase** via the Phase 2 Argon2
`KeyDerivationPort`. GCM gives **authenticated encryption** (a tampered backup
fails to decrypt); a plaintext **SHA-256 checksum** in the manifest is a second
integrity gate. **Restore is atomic and verify-first** — it decrypts, checks the
checksum, and only then imports inside a transaction, so a corrupt or
wrong-passphrase backup can never half-write the database.

---

## Scope & sequencing

| Concern                                                           | Phase 17          | Deferred to                |
| ----------------------------------------------------------------- | ----------------- | -------------------------- |
| Encrypt/verify/restore engine (AES-GCM + KDF + checksum)          | ✅ built + tested | —                          |
| `DataExportPort` (export/import all tables) + dev Prisma impl     | ✅                | —                          |
| `CreateBackup` / `RestoreBackup` use-cases (atomic, verify-first) | ✅                | —                          |
| Tamper / wrong-passphrase rejection                               | ✅                | —                          |
| On-disk DB-file copy / SQLCipher-at-rest                          | ⛔                | Shell (Tauri-SQL, ADR-008) |
| Scheduled/auto backups, retention                                 | ⛔                | Shell / later              |
| UI                                                                | ⛔                | Shell phase                |

---

## Objectives

1. A **`BackupCipher`** (infra) — AES-256-GCM encrypt/decrypt; key from
   `KeyDerivationPort.deriveKey(passphrase, salt)`; random per-backup salt + IV;
   the auth tag verifies integrity on decrypt.
2. A **backup envelope** — `{ manifest, ciphertext }`: manifest carries
   `formatVersion`, `createdAt`, `salt`, `iv`, `authTag`, plaintext `checksum`
   (SHA-256), and table counts.
3. A **`DataExportPort`** — `exportAll(): DatabaseSnapshot` and
   `importAll(snapshot)` (atomic replace); dev Prisma impl over all tables.
4. **`CreateBackup`** (`backup.create`) — export → serialize → checksum → encrypt
   → envelope; audited.
5. **`RestoreBackup`** (`backup.restore`) — decrypt (GCM-authenticated) → verify
   checksum → **import inside a transaction**; refuse on any integrity failure or
   wrong passphrase; audited.

**Out of scope:** on-disk DB-file backup, scheduling, UI.

---

## Deliverables

| #   | Deliverable                                                                                                                                   | Layer         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| D1  | `BackupCipher` (infra) — AES-256-GCM encrypt/decrypt + SHA-256 checksum, over `KeyDerivationPort`                                             | infra         |
| D2  | `BackupEnvelope` / `BackupManifest` / `DatabaseSnapshot` types; pure serialize + checksum helpers                                             | domain        |
| D3  | `DataExportPort` (app port) + dev `PrismaDataExport` (export/import all tables atomically)                                                    | port + infra  |
| D4  | `CreateBackup` use-case (`backup.create`)                                                                                                     | application   |
| D5  | `RestoreBackup` use-case (`backup.restore`) — verify-first, atomic import                                                                     | application   |
| D6  | Seed: `backup.create` permission (`backup.restore` already seeded)                                                                            | seed          |
| D7  | `scripts/demo-backup.ts` — create a backup, **tamper → restore fails**, wrong passphrase → fails, valid round-trip verifies (non-destructive) | scripts (dev) |
| D8  | Tests (≥80%) — cipher round-trip + tamper + wrong key, checksum, restore verify-first + atomicity, authz                                      | tests         |
| D9  | `/docs` update + implementation notes                                                                                                         | docs          |

---

## Architecture Decisions

- **AD17.1 — Authenticated encryption (AES-256-GCM).** The GCM auth tag makes a
  tampered ciphertext fail to decrypt — integrity is cryptographic, not advisory.
  A plaintext SHA-256 checksum in the manifest is a second, human-auditable gate.
- **AD17.2 — Key from the passphrase, never stored.** `deriveKey(passphrase,
salt)` (Phase 2 Argon2 KDF); a fresh random salt per backup lives in the
  manifest, so each backup is independently restorable and no key is persisted
  (ADR-008 alignment).
- **AD17.3 — Restore is verify-first + atomic.** Decrypt → checksum-verify →
  `importAll` inside a single transaction (UoW / `$transaction`). A failure at any
  step aborts with **zero writes** — never a half-restored database.
- **AD17.4 — Export/import behind a port.** `DataExportPort` keeps the use-cases
  free of Prisma; the dev impl dumps/loads all tables, the shell impl can swap to
  a Tauri-SQL file copy without touching the use-cases.
- **AD17.5 — Engine now, file-handling later.** This phase encrypts/verifies an
  in-memory snapshot; physical file read/write + SQLCipher-at-rest land with the
  Tauri-SQL shell. The demo is **non-destructive** (proves the crypto + integrity
  round-trip; the destructive `importAll` path is exercised by unit tests with a
  fake export port).

---

## Database Changes

- **None to the schema shape.** Reads/writes existing tables via the
  `DataExportPort`. `backup.restore` permission already seeded.
- **Seed:** add `backup.create` permission.

---

## UI Screens

**None in Phase 17.** Future consumer (deferred): backup/restore screen with
passphrase prompt + integrity status.

---

## Services / Use-cases (contracts, abridged)

- `BackupCipher.encrypt(plaintext, passphrase): { ciphertext, salt, iv, authTag }`
  / `decrypt(ciphertext, passphrase, { salt, iv, authTag }): plaintext`
- `DataExportPort.exportAll(): DatabaseSnapshot` / `importAll(snapshot): void`
- `CreateBackup.execute({ passphrase }, session): BackupEnvelope` → `backup.create`
- `RestoreBackup.execute({ envelope, passphrase }, session): { tables, rows }` → `backup.restore`

---

## Validation Rules

- Restore decrypts with GCM (auth tag must verify) **and** the plaintext checksum
  must match before any import; otherwise a clear integrity error, no writes.
- Wrong passphrase → derived key differs → GCM auth fails → rejected.
- `importAll` runs in one transaction (atomic, AD17.3).
- Both use-cases authorized (fail-closed) + audited (`BACKUP` / `RESTORE`).

---

## Test Plan

| Test                 | Asserts                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| cipher round-trip    | encrypt → decrypt returns the original plaintext                        |
| tamper               | flipping a ciphertext/auth-tag byte → decrypt throws (GCM)              |
| wrong passphrase     | decrypt with a different passphrase → throws                            |
| checksum             | a snapshot whose checksum doesn't match the manifest → restore rejected |
| restore atomicity    | a mid-import failure leaves no partial writes (fake export port)        |
| round-trip use-cases | CreateBackup → RestoreBackup imports the same snapshot                  |
| authz                | create gated by `backup.create`, restore by `backup.restore`            |
| coverage             | ≥80% on new code                                                        |

---

## Risks

| ID    | Risk                                   | Mitigation                                                                    |
| ----- | -------------------------------------- | ----------------------------------------------------------------------------- |
| P17-a | Restore corrupts data on a bad backup  | verify-first + atomic transaction (AD17.3); GCM + checksum                    |
| P17-b | Lost passphrase = unrecoverable backup | by design (no key stored); documented operator responsibility                 |
| P17-c | Large snapshots in memory              | acceptable for the engine; streaming + file I/O is the shell concern (AD17.5) |
| P17-d | Schema drift between backup + restore  | `manifest.formatVersion` gate; mismatched version refuses with guidance       |
| P17-e | Node `crypto` GCM misuse (IV reuse)    | fresh random IV per backup; IV stored in the manifest                         |

---

## Completion Criteria

- [ ] AES-GCM cipher (+ KDF + checksum), `DataExportPort`, and verify-first atomic
      `CreateBackup`/`RestoreBackup` built, gated, audited.
- [ ] `demo:backup` shows create, tamper-rejected, wrong-passphrase-rejected, and
      a verified round-trip (non-destructive).
- [ ] Tests pass; coverage ≥80% on new code; `tsc` strict clean; lint/format clean.
- [ ] Boundaries intact (use-cases free of crypto/Prisma; fitness test green).
- [ ] `/docs` updated; summary posted; **approval requested before Phase 18.**

---

## Approval Checklist (to start Phase 17 implementation)

- [ ] Scope confirmed: encrypt/verify/restore **engine**, logic only (on-disk DB-file backup deferred to the shell).
- [ ] Crypto: **AES-256-GCM** + key from the passphrase via the Phase 2 Argon2 KDF + plaintext SHA-256 checksum — OK?
- [ ] Restore is **verify-first + atomic** (refuse on tamper/wrong-passphrase, no partial writes) — OK.
- [ ] Backup envelope = manifest (formatVersion/createdAt/salt/iv/authTag/checksum) + ciphertext — OK?
- [ ] New `backup.create` permission (`backup.restore` already seeded) — OK?
- [ ] Demo is **non-destructive** (round-trip verification; destructive import via unit tests) — OK.
- [ ] Go-ahead to implement.

_Related: `src/application/ports/KeyDerivationPort.ts` + `Argon2KeyDerivationService` (Phase 2) ·
[architecture-review.md](../phase-0/architecture-review.md) (ADR-008 encrypt-at-rest) ·
[phase-7 tauri-sql-spec.md](../phase-7/tauri-sql-spec.md) (shell data layer)_
