/**
 * SecretBox — seal/open app-level secrets at rest (Phase 18, AD18.1). AES-256-GCM
 * keyed by the operator passphrase via the Phase 2 Argon2 `KeyDerivationPort`
 * (hashed to 32 bytes). The sealed value is SELF-CONTAINED (salt+iv+tag+ciphertext
 * in one base64 string), so it stores in a single setting field. `open` throws a
 * non-revealing `SecurityError` on a tampered blob or wrong passphrase.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { SecurityError } from "../../domain/errors/security";
import type { KeyDerivationPort } from "../../application/ports/KeyDerivationPort";
import type { SecretSealerPort } from "../../application/ports/SecretSealerPort";

const ALGORITHM = "aes-256-gcm";

interface SealedV1 {
  v: 1;
  salt: string; // hex
  iv: string; // base64
  tag: string; // base64
  ct: string; // base64
}

export class SecretBox implements SecretSealerPort {
  constructor(private readonly kdf: KeyDerivationPort) {}

  private async keyFor(passphrase: string, salt: string): Promise<Buffer> {
    const derived = await this.kdf.deriveKey(passphrase, salt);
    return createHash("sha256").update(derived).digest();
  }

  async seal(secret: string, passphrase: string): Promise<string> {
    const salt = randomBytes(16).toString("hex");
    const iv = randomBytes(12);
    const key = await this.keyFor(passphrase, salt);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ct = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    const sealed: SealedV1 = {
      v: 1,
      salt,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ct: ct.toString("base64"),
    };
    return Buffer.from(JSON.stringify(sealed), "utf8").toString("base64");
  }

  async open(sealedValue: string, passphrase: string): Promise<string> {
    let sealed: SealedV1;
    try {
      sealed = JSON.parse(
        Buffer.from(sealedValue, "base64").toString("utf8"),
      ) as SealedV1;
    } catch {
      throw new SecurityError("Sealed secret is malformed.");
    }
    const key = await this.keyFor(passphrase, sealed.salt);
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(sealed.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    try {
      return Buffer.concat([
        decipher.update(Buffer.from(sealed.ct, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new SecurityError(
        "Could not unlock — wrong passphrase or tampered secret.",
      );
    }
  }

  /** True if a value looks like a SecretBox-sealed blob (migration tolerance). */
  isSealed(value: string): boolean {
    try {
      const o = JSON.parse(Buffer.from(value, "base64").toString("utf8")) as {
        v?: unknown;
        ct?: unknown;
      };
      return o.v === 1 && typeof o.ct === "string";
    } catch {
      return false;
    }
  }
}
