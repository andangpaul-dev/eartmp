# Phase 17 — Implementation Notes & Verification

**Status:** Implemented. All gates green. **Awaiting approval to start Phase 18.**

Approved: encrypt/verify/restore engine (logic only); AES-256-GCM + passphrase
Argon2 KDF + SHA-256 checksum; restore verify-first + atomic; envelope =
manifest + ciphertext; new `backup.create`; non-destructive demo.

---

## Verification evidence (commands run)

| Gate                | Command                 | Result                                                                                                                                |
| ------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Type-check          | `npm run typecheck`     | **clean**                                                                                                                             |
| Lint (+ boundaries) | `npm run lint`          | **0 errors**                                                                                                                          |
| Format              | `npm run format:check`  | **conforms**                                                                                                                          |
| Tests               | `npm run test:coverage` | **246 passed**; stmts **93.4%** · branch **84.9%** · funcs **88.7%**                                                                  |
| Seed                | `npm run db:seed`       | idempotent; `backup.create` added                                                                                                     |
| End-to-end demo     | `npm run demo:backup`   | ✓ backup 24 tables/156 rows · ✓ **tamper rejected** · ✓ **wrong passphrase rejected** · ✓ valid round-trip verified (non-destructive) |

---

## What was built

- **`BackupCipher`** (`infrastructure/crypto/`) — **AES-256-GCM** authenticated
  encryption; key from the operator passphrase via the Phase 2 Argon2
  `KeyDerivationPort`, hashed to 32 bytes; fresh random salt + IV per backup. The
  GCM auth tag makes a tampered ciphertext fail to decrypt (AD17.1). SHA-256
  `checksum` for the second integrity gate.
- **Backup types** (`domain/services/Backup.ts`) — `DatabaseSnapshot`,
  `BackupManifest` (formatVersion/createdAt/salt/iv/authTag/checksum/table counts),
  `BackupEnvelope`. **`BackupCipherPort`** + **`DataExportPort`** keep the
  use-cases free of crypto/Prisma (AD17.4).
- **`CreateBackup`** (`backup.create`) — export → checksum → encrypt → envelope.
- **`RestoreBackup`** (`backup.restore`) — **verify-first** (decrypt → checksum)
  then **atomic `importAll`** (AD17.3); any integrity/passphrase failure aborts
  with **zero writes**. Rejects unsupported `formatVersion`.
- **`PrismaDataExport`** (dev) — dumps all 24 tables; `importAll` replaces data
  inside one `$transaction` (delete children→parents, insert parents→children).
- **Seed:** `backup.create`. `scripts/demo-backup.ts` (non-destructive).
- **Tests:** `backup-cipher.test.ts` (round-trip, tamper, wrong key, checksum) +
  `backup-use-cases.test.ts` (round-trip imports same snapshot, tamper/wrong-pass/
  checksum/format rejected with no import, authz). Real Argon2 + AES; the
  destructive `importAll` is exercised via a fake export port.

---

## Decisions honoured

- **Authenticated encryption + checksum** (AD17.1) — tamper fails (demo + tests).
- **Key from passphrase, never stored** (AD17.2) — fresh salt per backup.
- **Verify-first + atomic restore** (AD17.3) — no partial writes; tests assert
  `imported` stays null on rejection.
- **Export/import behind a port** (AD17.4); **engine now, file I/O later** (AD17.5)
  — demo is non-destructive; on-disk DB-file backup + SQLCipher is the shell
  concern (ADR-008).
- No schema changes (`backup.restore` already seeded; `Backup` table exists).

---

## Definition of Done (CLAUDE.md)

- [x] AES-GCM cipher + KDF + checksum, `DataExportPort`, verify-first atomic
      `CreateBackup`/`RestoreBackup` built, gated, audited.
- [x] `demo:backup` shows create, tamper-rejected, wrong-passphrase-rejected, and a
      verified round-trip (non-destructive).
- [x] Tests pass (246); coverage ≥80% (93.4%); `tsc` strict clean; lint/format clean.
- [x] Boundaries intact (use-cases free of crypto/Prisma; fitness test green).
- [x] `/docs` updated; summary posted; approval requested before Phase 18.

_Next: Phase 18 — Security Hardening (encrypt the transcript-signing private key +
DB-at-rest via the passphrase KDF; finalize ADR-008; audit/secrets review)._
