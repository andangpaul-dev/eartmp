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

## Wiring it into the host (remaining)

The factory is done; what's left is to call it from the composition root once the
operator unlocks, instead of the default plaintext `getPrisma()`:

1. Add an unlock step to the host (mirrors the signing-key unseal already there)
   that takes the operator passphrase, reads `institution.encryptionSalt`, and
   builds the client:
   ```ts
   const prisma = await getEncryptedPrisma(passphrase, salt, dbPath);
   const host = buildHost(prisma); // buildHost already accepts a PrismaClient
   ```
2. Until unlocked, the host serves no data (fail-closed), the same way transcript
   operations are refused until the signing key is unsealed.

The native `@libsql/client` ships in the sidecar `node_modules` (added to the
bundle externals), alongside Prisma's engine and `@node-rs/argon2`.

## Migrations on an encrypted DB (R-3 / F-32)

Apply `prisma/migrations/*/migration.sql` through the **keyed** connection on
first launch, then open normally. The migration SQL is identical; only the
connection is encrypted. No Prisma CLI/engine is needed at runtime. (Today
`src/infrastructure/db/bootstrap.ts` applies all migrations when the schema is
absent, keyed on the `User` table; per-migration tracking + transactional apply
is a Tier-3 follow-up.)

## Salt provisioning

`institution.encryptionSalt` is a settings row (Phase 3). Provision a random,
stable salt at install (≥ 16 bytes) and never change it — the key is
`Argon2id(passphrase, salt)`, so a changed salt makes the DB unreadable.
Passphrase rotation re-encrypts the DB under the new key (analogous to the
signing-key passphrase rotation already shipped).

## Open items

- Call `getEncryptedPrisma` from the host unlock flow at packaging time (per
  above) and re-point the persistence integration suite at it (parity check,
  same approach the Tauri-SQL spec describes).
- DB-key passphrase rotation (re-encrypt under a new key).
- Ship `@libsql/client` prebuilt for each target in the sidecar `node_modules`
  (it's a native module, like Prisma's engine and `@node-rs/argon2`).
