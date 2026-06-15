# Encryption-at-rest runbook (ADR-008)

How the packaged EARTMP encrypts the primary database on disk. The signing key
was always sealed; this closes the remaining gap — the **database file itself**.

## Mechanism (verified here)

- **Cipher:** SQLCipher, via `better-sqlite3-multiple-ciphers` (a drop-in
  better-sqlite3 with SQLite3 Multiple Ciphers). The DB file is unreadable
  without the key — its header is not `SQLite format 3`.
- **Key:** a 32-byte key derived from the operator passphrase + the
  `institution.encryptionSalt` setting via the existing Argon2id
  `KeyDerivationPort` (`src/infrastructure/crypto/Argon2KeyDerivationService`).
  Because Argon2 already stretched the passphrase, the key is applied **raw**
  (`PRAGMA key="x'<hex>'"`), not through SQLCipher's inner KDF.
- **Lifecycle:** derived **at unlock**, held in the sidecar's memory for the
  session, **never persisted** — same discipline as the transcript signing key.

Seam + proof:

- `src/infrastructure/db/encryptedDatabase.ts` — `deriveDbKey(passphrase, salt)`
  and `openEncryptedDatabase(file, keyHex)` (closes the handle if a wrong key
  fails the fast-check, so a bad key never leaks a file lock).
- `tests/infrastructure/encryptedDatabase.test.ts` — encrypted-header, key
  round-trip, wrong-key rejection, malformed-key guard (4 tests, green).
- `npm run verify:encryption` — end-to-end demonstration (derive → write →
  assert-encrypted → right/wrong/no-key), green.

## Wiring it into the Prisma sidecar (packaging-time)

The sidecar uses Prisma. Prisma's stock SQLite connector cannot open an encrypted
file, so route Prisma through a **driver adapter** backed by the keyed
connection:

1. Enable the preview feature and add the adapter:
   ```prisma
   // prisma/schema.prisma
   generator client {
     provider        = "prisma-client-js"
     previewFeatures = ["driverAdapters"]
   }
   ```
   ```
   npm i @prisma/adapter-better-sqlite3
   npx prisma generate
   ```
2. Construct the client from the keyed connection (replacing the plaintext
   `getPrisma()` on the encrypted path):

   ```ts
   import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";
   import { openEncryptedDatabase, deriveDbKey } from "./encryptedDatabase";

   export async function getEncryptedPrisma(
     passphrase: string,
     salt: string,
     file: string,
   ) {
     const key = await deriveDbKey(passphrase, salt);
     const conn = openEncryptedDatabase(file, key); // keyed SQLCipher handle
     const adapter = new PrismaBetterSQLite3(conn);
     return new PrismaClient({ adapter });
   }
   ```

3. The host composition root calls `getEncryptedPrisma(...)` once the operator
   unlocks (mirrors the signing-key unseal already in the host), instead of the
   default plaintext `getPrisma()`.

> Deferred from this environment because `prisma generate` with `driverAdapters`
> changes the generated client and is best done on the packaging workstation
> alongside the Tauri build (keeps the 288-test dev suite stable). The mechanism
> it depends on is already proven above.

## Migrations on an encrypted DB (R-3 / F-32)

Apply `prisma/migrations/*/migration.sql` through the **keyed** connection on
first launch (a tiny `_migrations` bookkeeping table records what's applied), then
open normally. The migration SQL is identical; only the connection is encrypted.
No Prisma CLI/engine is needed at runtime.

## Salt provisioning

`institution.encryptionSalt` is a settings row (Phase 3). Provision a random,
stable salt at install (≥ 16 bytes) and never change it — the key is
`Argon2id(passphrase, salt)`, so a changed salt makes the DB unreadable. Rotating
the passphrase re-keys the DB with `PRAGMA rekey` (a follow-up, analogous to the
signing-key passphrase rotation already shipped).

## Open items

- Implement `getEncryptedPrisma` + the unlock flow in the host at packaging time
  (per above) and re-point the persistence integration suite at it (parity check,
  same approach the Tauri-SQL spec describes).
- `PRAGMA rekey` passphrase rotation for the DB key.
- Ship `better-sqlite3-multiple-ciphers` prebuilt for each target in the sidecar
  `node_modules` (it's a native module, like Prisma's engine and `@node-rs/argon2`).
