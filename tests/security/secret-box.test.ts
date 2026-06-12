import { describe, it, expect } from "vitest";
import { SecretBox } from "../../src/infrastructure/crypto/SecretBox";
import { Argon2KeyDerivationService } from "../../src/infrastructure/crypto/Argon2KeyDerivationService";
import { SecurityError } from "../../src/domain/errors/security";

const box = new SecretBox(new Argon2KeyDerivationService());
const PASS = "operator passphrase";

describe("SecretBox", () => {
  it("seals and opens a secret (round-trip)", async () => {
    const sealed = await box.seal("the private key PEM", PASS);
    expect(sealed).not.toContain("the private key PEM");
    expect(await box.open(sealed, PASS)).toBe("the private key PEM");
  }, 30000);

  it("isSealed recognises a sealed blob, not plaintext", async () => {
    const sealed = await box.seal("x", PASS);
    expect(box.isSealed(sealed)).toBe(true);
    expect(box.isSealed("-----BEGIN PRIVATE KEY-----")).toBe(false);
  }, 30000);

  it("rejects a wrong passphrase", async () => {
    const sealed = await box.seal("secret", PASS);
    await expect(box.open(sealed, "wrong")).rejects.toBeInstanceOf(
      SecurityError,
    );
  }, 30000);

  it("rejects a tampered blob", async () => {
    const sealed = await box.seal("secret", PASS);
    const i = Math.floor(sealed.length / 2);
    const bad =
      sealed.slice(0, i) +
      (sealed[i] === "A" ? "B" : "A") +
      sealed.slice(i + 1);
    await expect(box.open(bad, PASS)).rejects.toBeInstanceOf(SecurityError);
  }, 30000);

  it("rejects a malformed blob", async () => {
    await expect(box.open("not-a-blob", PASS)).rejects.toBeInstanceOf(
      SecurityError,
    );
  });
});
