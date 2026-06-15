/**
 * Encrypted SQLite at rest (ADR-008). Opens an SQLCipher-encrypted database
 * keyed by a 32-byte key derived from the operator passphrase + the
 * `institution.encryptionSalt` setting via the Argon2 KeyDerivationPort. The key
 * is derived at unlock and never persisted.
 *
 * This is the connection the packaged Node sidecar uses for the primary DB; it
 * plugs into Prisma through the driver adapter (see docs/encryption-runbook.md).
 * The default dev flow remains the plaintext Prisma client until encryption is
 * enabled at packaging time.
 */
import Database from "better-sqlite3-multiple-ciphers";
import { Argon2KeyDerivationService } from "../crypto/Argon2KeyDerivationService";
import type { KeyDerivationPort } from "../../application/ports/KeyDerivationPort";

export type EncryptedDb = Database.Database;

/** Derive the raw DB key (hex) from passphrase + salt. Deterministic. */
export async function deriveDbKey(
  passphrase: string,
  salt: string,
  kdf: KeyDerivationPort = new Argon2KeyDerivationService(),
): Promise<string> {
  return kdf.deriveKey(passphrase, salt);
}

/**
 * Open (or create) an SQLCipher-encrypted SQLite file with a raw 32-byte key
 * (hex). The Argon2 KDF already stretched the passphrase, so the key is applied
 * raw (`x'...'`) rather than through SQLCipher's inner KDF.
 */
export function openEncryptedDatabase(
  file: string,
  keyHex: string,
): EncryptedDb {
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
    throw new Error("Encryption key must be 32 bytes (64 hex chars).");
  }
  const db = new Database(file);
  try {
    db.pragma("cipher='sqlcipher'");
    db.pragma(`key="x'${keyHex}'"`);
    // Touch the schema so a wrong key fails fast here rather than on first query.
    db.pragma("user_version");
    return db;
  } catch (e) {
    // Close the handle so a wrong key doesn't leak a lock on the file.
    db.close();
    throw e;
  }
}
