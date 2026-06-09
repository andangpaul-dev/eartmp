import { describe, it, expect } from "vitest";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";

describe("SessionContext", () => {
  it("reports granted permissions", () => {
    const s = SessionContext.create("u1", "REGISTRAR", [
      "students.read",
      "results.process",
    ]);
    expect(s.has("students.read")).toBe(true);
    expect(s.has("backup.restore")).toBe(false);
    expect(s.hasAll(["students.read", "results.process"])).toBe(true);
    expect(s.hasAll(["students.read", "missing"])).toBe(false);
    expect(s.permissionList().sort()).toEqual([
      "results.process",
      "students.read",
    ]);
    expect(s.isAnonymous).toBe(false);
    expect(s.actorId).toBe("u1");
  });

  it("anonymous() has no identity or permissions", () => {
    const a = SessionContext.anonymous();
    expect(a.isAnonymous).toBe(true);
    expect(a.has("anything")).toBe(false);
    expect(a.hasAll([])).toBe(true); // vacuously true
  });

  it("requires an actor id for an authenticated session", () => {
    expect(() => SessionContext.create("", "X", [])).toThrow(/actor id/);
  });
});
