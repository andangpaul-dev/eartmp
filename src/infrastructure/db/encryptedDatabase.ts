/**
 * Encrypted SQLite at rest (ADR-008) for the packaged Node sidecar.
 *
 * Prisma's stock SQLite connector can't open an encrypted database, so the
 * encrypted path runs Prisma through the **libSQL driver adapter**, whose client
 * takes an `encryptionKey`. The key is a 32-byte value derived from the operator
 * passphrase + the `institution.encryptionSalt` setting via the Argon2
 * KeyDerivationPort — derived at unlock, never persisted (same discipline as the
 * transcript signing key).
 *
 * The default dev flow keeps the plaintext `getPrisma()` until encryption is
 * enabled at packaging time; this factory is the encrypted equivalent.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { Argon2KeyDerivationService } from "../crypto/Argon2KeyDerivationService";
import type { KeyDerivationPort } from "../../application/ports/KeyDerivationPort";

/** Thrown when the DB salt is missing/empty but its encrypted DB still exists. */
export class MissingDbSaltError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingDbSaltError";
  }
}

function dbFileExists(dbFile: string): boolean {
  return existsSync(dbFile) && statSync(dbFile).size > 0;
}

/**
 * Read (or create) the per-install KDF salt for the DB key. The salt is NOT
 * secret — only the passphrase is — so it lives in a plaintext sidecar next to
 * the encrypted DB. A stable per-install salt prevents the same passphrase from
 * deriving the same key across machines.
 *
 * CRITICAL: the salt and the encrypted DB are an atomic pair. Minting a fresh
 * salt when an encrypted DB already exists would derive a DIFFERENT key and
 * orphan that DB (it would no longer decrypt — SQLITE_NOTADB). So a new salt is
 * minted ONLY on a genuinely fresh install (no DB yet); if the DB exists but the
 * salt is missing or empty, we FAIL LOUDLY rather than silently corrupting
 * access — the salt must be restored from backup alongside the DB.
 */
export function resolveDbSalt(dbFile: string): string {
  const saltFile = `${dbFile}.salt`;
  if (existsSync(saltFile)) {
    const salt = readFileSync(saltFile, "utf8").trim();
    if (salt.length > 0) return salt;
    if (dbFileExists(dbFile)) {
      throw new MissingDbSaltError(
        `The DB salt file "${saltFile}" is empty, but the encrypted database ` +
          `"${dbFile}" exists. The salt is required to derive its decryption ` +
          `key. Restore the salt file from your backup (it must be kept with ` +
          `the database), or remove both to re-provision from a logical backup.`,
      );
    }
    // Empty salt + no DB ⇒ treat as fresh: fall through and mint one.
  } else if (dbFileExists(dbFile)) {
    throw new MissingDbSaltError(
      `The DB salt file "${saltFile}" is missing, but the encrypted database ` +
        `"${dbFile}" exists. Minting a new salt would orphan the database ` +
        `(it could no longer be decrypted). Restore the salt file from your ` +
        `backup (it must be kept with the database), or remove both to ` +
        `re-provision from a logical backup.`,
    );
  }
  const salt = randomBytes(16).toString("hex");
  writeFileSync(saltFile, salt, "utf8");
  return salt;
}

/** Derive the raw DB key (hex) from passphrase + salt. Deterministic. */
export async function deriveDbKey(
  passphrase: string,
  salt: string,
  kdf: KeyDerivationPort = new Argon2KeyDerivationService(),
): Promise<string> {
  return kdf.deriveKey(passphrase, salt);
}

/**
 * Build a PrismaClient backed by an encrypted local libSQL database. `file` is a
 * filesystem path; it is opened as `file:<path>` with the derived key. Wrong key
 * ⇒ queries fail (the file cannot be decrypted).
 */
export async function getEncryptedPrisma(
  passphrase: string,
  salt: string,
  file: string,
  kdf?: KeyDerivationPort,
): Promise<PrismaClient> {
  const key = await deriveDbKey(passphrase, salt, kdf);
  const adapter = new PrismaLibSQL({
    url: `file:${file}`,
    encryptionKey: key,
  });
  const prisma = new PrismaClient({ adapter });
  // Wait up to 5s for a transient lock (e.g. a restarting sidecar releasing the
  // file) instead of failing immediately with SQLITE_BUSY ("database is locked").
  await prisma.$executeRawUnsafe("PRAGMA busy_timeout = 5000");
  return prisma;
}
