/**
 * Real Argon2id integration test (no DB, no UI — just CPU). Proves the
 * production HashingPort implementation actually hashes and verifies.
 */
import { describe, it, expect } from "vitest";
import { Argon2HashingService } from "../../src/infrastructure/crypto/Argon2HashingService";

describe("Argon2HashingService", () => {
  const svc = new Argon2HashingService();

  it("produces an argon2id hash that is not the plaintext", async () => {
    const h = await svc.hash("correct horse");
    expect(h).not.toContain("correct horse");
    expect(h.startsWith("$argon2id$")).toBe(true);
  });

  it("verifies the correct password and rejects a wrong one", async () => {
    const h = await svc.hash("s3cret!");
    expect(await svc.verify("s3cret!", h)).toBe(true);
    expect(await svc.verify("nope", h)).toBe(false);
  });

  it("salts: the same password hashes to different values", async () => {
    const a = await svc.hash("same");
    const b = await svc.hash("same");
    expect(a).not.toBe(b);
    expect(await svc.verify("same", a)).toBe(true);
    expect(await svc.verify("same", b)).toBe(true);
  });

  it("returns false (never throws) for a malformed hash", async () => {
    expect(await svc.verify("x", "not-a-hash")).toBe(false);
  });
});
