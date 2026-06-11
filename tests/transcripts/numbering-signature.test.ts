import { describe, it, expect } from "vitest";
import { expandNumberRule } from "../../src/domain/services/TranscriptNumber";
import { CryptoSignatureService } from "../../src/infrastructure/crypto/CryptoSignatureService";

describe("expandNumberRule", () => {
  it("expands year and zero-padded sequence", () => {
    expect(expandNumberRule("TR-{year}-{seq:000000}", 2026, 42)).toBe(
      "TR-2026-000042",
    );
  });
  it("supports a bare seq token", () => {
    expect(expandNumberRule("{year}/{seq}", 2026, 7)).toBe("2026/7");
  });
});

describe("CryptoSignatureService (Ed25519)", () => {
  const { publicKeyPem, privateKeyPem } =
    CryptoSignatureService.generateKeypair();
  const svc = new CryptoSignatureService(privateKeyPem, publicKeyPem);

  it("signs and verifies the same data", () => {
    const { signature } = svc.sign("hello snapshot");
    expect(svc.verify("hello snapshot", signature)).toBe(true);
  });

  it("fails verification when the data is tampered", () => {
    const { signature } = svc.sign("original");
    expect(svc.verify("tampered", signature)).toBe(false);
  });

  it("returns false (never throws) for a malformed signature", () => {
    expect(svc.verify("x", "not-base64-sig!!")).toBe(false);
  });

  it("rejects a signature from a different key", () => {
    const other = CryptoSignatureService.generateKeypair();
    const otherSvc = new CryptoSignatureService(
      other.privateKeyPem,
      other.publicKeyPem,
    );
    const { signature } = otherSvc.sign("data");
    expect(svc.verify("data", signature)).toBe(false);
  });
});
