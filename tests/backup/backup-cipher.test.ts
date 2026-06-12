import { describe, it, expect } from "vitest";
import { BackupCipher } from "../../src/infrastructure/crypto/BackupCipher";
import { Argon2KeyDerivationService } from "../../src/infrastructure/crypto/Argon2KeyDerivationService";

const cipher = new BackupCipher(new Argon2KeyDerivationService());
const PASS = "a strong passphrase";

describe("BackupCipher (AES-256-GCM)", () => {
  it("round-trips encrypt → decrypt", async () => {
    const plaintext = JSON.stringify({ hello: "world", n: 42 });
    const enc = await cipher.encrypt(plaintext, PASS);
    const out = await cipher.decrypt(enc.ciphertext, PASS, enc);
    expect(out).toBe(plaintext);
  }, 30000);

  it("fails to decrypt a tampered ciphertext (GCM auth)", async () => {
    const enc = await cipher.encrypt("secret data", PASS);
    const i = Math.floor(enc.ciphertext.length / 2);
    const tampered =
      enc.ciphertext.slice(0, i) +
      (enc.ciphertext[i] === "A" ? "B" : "A") +
      enc.ciphertext.slice(i + 1);
    await expect(cipher.decrypt(tampered, PASS, enc)).rejects.toBeTruthy();
  }, 30000);

  it("fails to decrypt with the wrong passphrase", async () => {
    const enc = await cipher.encrypt("secret data", PASS);
    await expect(
      cipher.decrypt(enc.ciphertext, "wrong passphrase", enc),
    ).rejects.toBeTruthy();
  }, 30000);

  it("checksum is deterministic and content-sensitive", () => {
    expect(cipher.checksum("abc")).toBe(cipher.checksum("abc"));
    expect(cipher.checksum("abc")).not.toBe(cipher.checksum("abd"));
  });
});
