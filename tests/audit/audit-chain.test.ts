import { describe, it, expect } from "vitest";
import {
  canonicalAuditPayload,
  verifyAuditChain,
  type AuditEntry,
} from "../../src/domain/services/AuditChain";

// A deterministic test "hash": prefix-tagged identity (enough to chain/verify).
const link = (prev: string, payload: string): string => `h(${prev}|${payload})`;

/** Build a correctly-chained list of entries. */
function chain(
  contents: Array<Partial<AuditEntry> & { id: string }>,
): AuditEntry[] {
  const out: AuditEntry[] = [];
  let prev = "";
  for (const c of contents) {
    const e: AuditEntry = {
      action: "A",
      entity: "E",
      createdAt: "2026-01-01T00:00:00.000Z",
      ...c,
      prevHash: prev || undefined,
    };
    e.hash = link(prev, canonicalAuditPayload(e));
    out.push(e);
    prev = e.hash;
  }
  return out;
}

describe("canonicalAuditPayload", () => {
  it("is deterministic for the same content", () => {
    const e = { action: "X", entity: "E", recordId: "r", createdAt: "t" };
    expect(canonicalAuditPayload(e)).toBe(canonicalAuditPayload({ ...e }));
  });
});

describe("verifyAuditChain", () => {
  it("verifies a clean chain", () => {
    const entries = chain([{ id: "1" }, { id: "2" }, { id: "3" }]);
    const r = verifyAuditChain(entries, link);
    expect(r).toMatchObject({ valid: true, checked: 3 });
    expect(r.brokenAt).toBeUndefined();
  });

  it("flags content tampering at the first edited entry", () => {
    const entries = chain([{ id: "1" }, { id: "2" }, { id: "3" }]);
    entries[1]!.newValue = '{"tampered":true}'; // change content, keep old hash
    const r = verifyAuditChain(entries, link);
    expect(r.valid).toBe(false);
    expect(r.brokenAt).toMatchObject({ index: 1, id: "2", reason: "content" });
  });

  it("flags a deleted entry as a linkage break", () => {
    const entries = chain([{ id: "1" }, { id: "2" }, { id: "3" }]);
    entries.splice(1, 1); // delete entry 2 → entry 3's prevHash no longer links
    const r = verifyAuditChain(entries, link);
    expect(r.valid).toBe(false);
    expect(r.brokenAt).toMatchObject({ index: 1, reason: "linkage" });
  });

  it("flags a nulled hash on the LAST entry (tail truncation)", () => {
    const entries = chain([{ id: "1" }, { id: "2" }, { id: "3" }]);
    delete entries[2]!.hash; // null the tail hash — a plain skip would hide this
    const r = verifyAuditChain(entries, link);
    expect(r.valid).toBe(false);
    expect(r.brokenAt).toMatchObject({ index: 2, reason: "missing-hash" });
  });

  it("flags a nulled hash in the MIDDLE of the chain", () => {
    const entries = chain([{ id: "1" }, { id: "2" }, { id: "3" }]);
    delete entries[1]!.hash;
    const r = verifyAuditChain(entries, link);
    expect(r.valid).toBe(false);
    expect(r.brokenAt).toMatchObject({ index: 1, reason: "missing-hash" });
  });

  it("reports total alongside checked", () => {
    const entries = chain([{ id: "1" }, { id: "2" }]);
    expect(verifyAuditChain(entries, link)).toMatchObject({
      valid: true,
      checked: 2,
      total: 2,
    });
  });

  it("skips pre-chain (unhashed) entries", () => {
    const legacy: AuditEntry = {
      id: "0",
      action: "A",
      entity: "E",
      createdAt: "t",
    };
    const entries = [legacy, ...chain([{ id: "1" }, { id: "2" }])];
    expect(verifyAuditChain(entries, link)).toMatchObject({
      valid: true,
      checked: 2,
    });
  });
});
