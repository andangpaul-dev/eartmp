import { describe, it, expect } from "vitest";
import {
  canOverrideResults,
  RESULTS_OVERRIDE,
} from "../../src/application/authorization/resultsOverride";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";

describe("canOverrideResults", () => {
  it("is true only when the session holds results.override", () => {
    const admin = SessionContext.create("a", "SUPER_ADMIN", [
      "results.override",
    ]);
    const officer = SessionContext.create("o", "FACULTY_OFFICER", [
      "results.process",
    ]);
    expect(canOverrideResults(admin)).toBe(true);
    expect(canOverrideResults(officer)).toBe(false);
  });
  it("exposes the permission key", () => {
    expect(RESULTS_OVERRIDE).toBe("results.override");
  });
});
