/**
 * CryptoSignatureService — Ed25519 SignaturePort over Node `crypto` (ADR-009).
 * Signs/verifies arbitrary data (Ed25519 hashes internally), so the snapshot
 * string is signed directly. `keyId` is a short fingerprint of the public key.
 *
 * Key storage: the keypair is provisioned once (see `generateKeypair`). For the
 * dev build the PEMs live in settings; production must encrypt the private key at
 * rest via the passphrase KDF (hardening, P18/19).
 */
import {
  sign as cryptoSign,
  verify as cryptoVerify,
  createPrivateKey,
  createPublicKey,
  createHash,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import type {
  SignaturePort,
  SignatureResult,
} from "../../application/ports/SignaturePort";

export class CryptoSignatureService implements SignaturePort {
  private readonly privateKey: KeyObject | null;
  private readonly publicKey: KeyObject;
  readonly keyId: string;

  constructor(privateKeyPem: string | null, publicKeyPem: string) {
    this.privateKey = privateKeyPem ? createPrivateKey(privateKeyPem) : null;
    this.publicKey = createPublicKey(publicKeyPem);
    this.keyId = createHash("sha256")
      .update(publicKeyPem)
      .digest("hex")
      .slice(0, 16);
  }

  /** A verify-only signer (public key only) — for third-party verification. */
  static verifier(publicKeyPem: string): CryptoSignatureService {
    return new CryptoSignatureService(null, publicKeyPem);
  }

  sign(data: string): SignatureResult {
    if (!this.privateKey) {
      throw new Error("This signer is verify-only (no private key).");
    }
    const sig = cryptoSign(null, Buffer.from(data, "utf8"), this.privateKey);
    return { signature: sig.toString("base64"), keyId: this.keyId };
  }

  verify(data: string, signature: string): boolean {
    try {
      return cryptoVerify(
        null,
        Buffer.from(data, "utf8"),
        this.publicKey,
        Buffer.from(signature, "base64"),
      );
    } catch {
      return false;
    }
  }

  /** Generate a fresh Ed25519 keypair as PEM strings. */
  static generateKeypair(): { publicKeyPem: string; privateKeyPem: string } {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    return {
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) as string,
      privateKeyPem: privateKey.export({
        type: "pkcs8",
        format: "pem",
      }) as string,
    };
  }
}
