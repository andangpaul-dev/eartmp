/**
 * BackupCipher — AES-256-GCM authenticated encryption for backups (Phase 17,
 * AD17.1). The key is derived from the operator passphrase via the Phase 2
 * `KeyDerivationPort` (Argon2id) and hashed to exactly 32 bytes; a fresh random
 * salt + IV per backup. GCM's auth tag makes a tampered ciphertext fail to
 * decrypt. The only place that touches the cipher primitives.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type {
  BackupCipherPort,
  CipherParams,
  EncryptResult,
} from "../../application/ports/BackupCipherPort";
import type { KeyDerivationPort } from "../../application/ports/KeyDerivationPort";

const ALGORITHM = "aes-256-gcm";

export class BackupCipher implements BackupCipherPort {
  constructor(private readonly kdf: KeyDerivationPort) {}

  private async keyFor(passphrase: string, salt: string): Promise<Buffer> {
    const derived = await this.kdf.deriveKey(passphrase, salt);
    // Normalise any KDF output to exactly 32 bytes for AES-256.
    return createHash("sha256").update(derived).digest();
  }

  async encrypt(plaintext: string, passphrase: string): Promise<EncryptResult> {
    const salt = randomBytes(16).toString("hex");
    const iv = randomBytes(12);
    const key = await this.keyFor(passphrase, salt);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ct = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return {
      ciphertext: ct.toString("base64"),
      salt,
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
    };
  }

  async decrypt(
    ciphertext: string,
    passphrase: string,
    params: CipherParams,
  ): Promise<string> {
    const key = await this.keyFor(passphrase, params.salt);
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(params.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(params.authTag, "base64"));
    // `final()` throws if the auth tag (integrity/passphrase) is wrong.
    const pt = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64")),
      decipher.final(),
    ]);
    return pt.toString("utf8");
  }

  checksum(plaintext: string): string {
    return createHash("sha256").update(plaintext, "utf8").digest("hex");
  }
}
