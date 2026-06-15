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
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { Argon2KeyDerivationService } from "../crypto/Argon2KeyDerivationService";
import type { KeyDerivationPort } from "../../application/ports/KeyDerivationPort";

/**
 * Read (or create) the per-install KDF salt for the DB key. The salt is NOT
 * secret — only the passphrase is — so it lives in a plaintext sidecar next to
 * the encrypted DB. A stable per-install salt prevents the same passphrase from
 * deriving the same key across machines.
 */
export function resolveDbSalt(dbFile: string): string {
  const saltFile = `${dbFile}.salt`;
  if (existsSync(saltFile)) return readFileSync(saltFile, "utf8").trim();
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
  return new PrismaClient({ adapter });
}
