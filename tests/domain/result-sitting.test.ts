import { describe, it, expect } from "vitest";
import {
  RESULT_SITTINGS,
  RESULT_STATUSES,
  assertSitting,
  assertStatus,
  countsAsFail,
  isPending,
} from "../../src/domain/value-objects/ResultSitting";

describe("ResultSitting / ResultStatus", () => {
  it("enumerates the allowed values", () => {
    expect([...RESULT_SITTINGS]).toEqual(["NORMAL", "RESIT"]);
    expect([...RESULT_STATUSES]).toEqual([
      "GRADED",
      "DID",
      "DISQUALIFIED",
      "INCOMPLETE",
    ]);
  });
  it("assertSitting/assertStatus reject unknown values", () => {
    expect(() => assertSitting("RESIT")).not.toThrow();
    expect(() => assertSitting("EXTRA")).toThrow(/sitting/i);
    expect(() => assertStatus("DID")).not.toThrow();
    expect(() => assertStatus("NOPE")).toThrow(/status/i);
  });
  it("classifies statuses for GPA", () => {
    expect(countsAsFail("DID")).toBe(true);
    expect(countsAsFail("DISQUALIFIED")).toBe(true);
    expect(countsAsFail("GRADED")).toBe(false);
    expect(isPending("INCOMPLETE")).toBe(true);
    expect(isPending("GRADED")).toBe(false);
  });
});
