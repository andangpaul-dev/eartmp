/**
 * Argon2KeyDerivationService — KeyDerivationPort impl (ADR-008 groundwork).
 *
 * Derives deterministic key material from a passphrase + salt using Argon2id
 * (memory-hard). Used later for DB-at-rest (SQLCipher) and backup encryption.
 * Deterministic for a given (passphrase, salt) because the salt is supplied,
 * not random.
 */
import { hashRaw, Algorithm } from "@node-rs/argon2";
import type { KeyDerivationPort } from "../../application/ports/KeyDerivationPort";

export class Argon2KeyDerivationService implements KeyDerivationPort {
  async deriveKey(passphrase: string, salt: string): Promise<string> {
    const key = await hashRaw(passphrase, {
      algorithm: Algorithm.Argon2id,
      memoryCost: 19456,
      timeCost: 3,
      parallelism: 1,
      salt: Buffer.from(salt, "utf8"),
      outputLen: 32,
    });
    return Buffer.from(key).toString("hex");
  }
}
