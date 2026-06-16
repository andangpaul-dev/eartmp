# Encryption-at-rest runbook (ADR-008)

How the packaged EARTMP encrypts the primary database on disk. The signing key
was always sealed; this closes the remaining gap — the **database file itself**.

## Mechanism (verified here — Prisma reads/writes an encrypted DB)

Prisma's stock SQLite connector can't open an encrypted file, so the encrypted
path runs **Prisma through the libSQL driver adapter**, whose client takes an
`encryptionKey`. (We started with SQLCipher/`better-sqlite3-multiple-ciphers`,
but its Prisma adapter opens its own connection with no hook to run `PRAGMA key`
before queries — so it can't drive a keyed DB. libSQL is the adapter that
supports encryption directly.)

- **Cipher:** libSQL local encryption (AES). The DB file is unreadable without
  the key — its header is not `SQLite format 3`, and a wrong key fails with
  `SQLITE_NOTADB`.
- **Key:** a 32-byte key derived from the operator passphrase + the
  `institution.encryptionSalt` setting via the existing Argon2id
  `KeyDerivationPort` (`src/infrastructure/crypto/Argon2KeyDerivationService`),
  passed as the libSQL `encryptionKey`.
- **Lifecycle:** derived **at unlock**, held in the sidecar's memory for the
  session, **never persisted** — same discipline as the transcript signing key.

Seam + proof (implemented, not deferred):

- `src/infrastructure/db/encryptedDatabase.ts` — `deriveDbKey(passphrase, salt)`
  and `getEncryptedPrisma(passphrase, salt, file)` returning a `PrismaClient`
  backed by `new PrismaLibSQL({ url: "file:<path>", encryptionKey })`.
- `tests/infrastructure/encryptedDatabase.test.ts` — deterministic key,
  **Prisma actually CREATE/INSERT/SELECTs over the encrypted DB**, the on-disk
  file is not plaintext SQLite, and a wrong key is rejected (3 tests, green).
- `npm run verify:encryption` — the same end-to-end demonstration via Prisma,
  green.

`driverAdapters` is GA in Prisma 6.19 (no preview flag needed); the default dev
`getPrisma()` is unchanged, so the full suite stays green.

## Wiring into the host (implemented)

The host (`src/host/server.ts`) now selects the DB connection at startup:

- `EARTMP_DB_PASSPHRASE` set → encrypted, **auto-unlocked** with it (UAT builds).
- `EARTMP_REQUIRE_UNLOCK=1` → encrypted, **locked** until `/api/unlock` with the
  operator passphrase (production builds).
- neither → plaintext `getPrisma()` (dev).

While locked, `core` is null and every data route returns `LOCKED`; the webview
shows the **Unlock screen** (`src/presentation/screens/UnlockScreen.tsx`), routed
from `App.tsx` via `GET /api/lock-state`. On `/api/unlock` the host derives the
key (`getEncryptedPrisma(passphrase, salt, dbFile)`), and — if the DB already
exists — **probes a real table to fail fast on a wrong passphrase** before
running any migration (a wrong key can't decrypt and must not be migrated into).
On first run the passphrase the operator enters becomes the DB password. The
per-install KDF salt lives in a plaintext sidecar (`<db>.salt`, not secret).

The Tauri supervisor (`src-tauri/src/lib.rs`) sets `EARTMP_DB_PASSPHRASE` under
the `uat` feature and `EARTMP_REQUIRE_UNLOCK=1` otherwise. The native
`@libsql/client` ships in the sidecar `node_modules` (bundle externals).

Proven: `tests/infrastructure/encrypted-bootstrap.test.ts` (migrate+seed over an
encrypted connection) and `encryptedDatabase.test.ts` (wrong-key rejection);
verified live that auto-unlock provisions + logs in and the on-disk file is
encrypted. Note: first-launch provisioning over the encrypted connection takes
~15–20 s (the webview polls `lock-state` until the host is ready).

## Migrations on an encrypted DB (R-3 / F-32)

Apply `prisma/migrations/*/migration.sql` through the **keyed** connection on
first launch, then open normally. The migration SQL is identical; only the
connection is encrypted. No Prisma CLI/engine is needed at runtime.
`src/infrastructure/db/migrationRunner.ts` records each applied migration in a
`_eartmp_migrations` table, applies each in its own transaction, splits
statements with a quote/comment-aware splitter, and baselines a pre-existing
untracked schema — so app updates apply only pending migrations. `bootstrap.ts`
then seeds only when the DB was empty.

## Salt provisioning & the salt↔DB coupling (CRITICAL)

The per-install KDF salt lives in a **plaintext sidecar file next to the DB**:
`<db>.salt` (e.g. `eartmp.db.salt`), managed by `resolveDbSalt(dbFile)` in
`src/infrastructure/db/encryptedDatabase.ts`. It is **not secret** (only the
passphrase is); a stable per-install salt stops the same passphrase deriving the
same key across machines.

The key is `Argon2id(passphrase, salt)`, so **the salt and the encrypted DB are
an atomic pair**: lose or regenerate the salt and the DB can no longer be
decrypted (`SQLITE_NOTADB`) — exactly as fatal as losing the passphrase. This
actually bit us once: a `.salt` newer than its `eartmp.db` (the salt had been
regenerated) left the DB un-openable.

**Fail-loud guard (implemented).** `resolveDbSalt` mints a new salt **only on a
genuinely fresh install** (no DB file yet). If the DB exists but the salt is
missing or empty, it throws `MissingDbSaltError` with an actionable message
instead of silently minting a new (wrong) salt and orphaning the DB. The host
surfaces this distinctly on `/api/unlock` (logged + a real message, not masked
as "incorrect passphrase"). Covered by
`tests/infrastructure/resolve-db-salt.test.ts`.

**Backup & recovery.** Two independent recovery paths:

1. **Logical backup (recommended, salt-independent).** `CreateBackup` exports a
   JSON snapshot and encrypts it under its own passphrase with a salt embedded
   in the envelope manifest — it does **not** depend on `<db>.salt`. To recover
   on any machine: install fresh (a new salt + empty encrypted DB are
   provisioned), unlock, then `RestoreBackup`. This survives total loss of the
   original salt.
2. **Raw file copy.** If you instead copy the `eartmp.db` file directly, you
   **must** copy `eartmp.db.salt` alongside it — back them up and restore them
   **together**, atomically. A DB without its salt is unrecoverable.

Passphrase rotation re-encrypts the DB under the new key (analogous to the
signing-key passphrase rotation already shipped); the salt is unchanged by it.

## Open items

- Call `getEncryptedPrisma` from the host unlock flow at packaging time (per
  above) and re-point the persistence integration suite at it (parity check,
  same approach the Tauri-SQL spec describes).
- DB-key passphrase rotation (re-encrypt under a new key).
- Ship `@libsql/client` prebuilt for each target in the sidecar `node_modules`
  (it's a native module, like Prisma's engine and `@node-rs/argon2`).
