import { describe, it, expect } from "vitest";
import {
  luhnDigit,
  mod97Digits,
  computeCheck,
} from "../../src/domain/services/MatriculeCheck";
describe("matricule check digits", () => {
  it("luhn over decimal digits is deterministic", () => {
    expect(luhnDigit("7992739871")).toBe("3");
    expect(luhnDigit("FS25-0042")).toBe(luhnDigit("250042"));
  });
  it("mod97 returns two digits and is stable", () => {
    const d = mod97Digits("FS250042");
    expect(d).toMatch(/^\d\d$/);
    expect(mod97Digits("FS250042")).toBe(d);
  });
  it("computeCheck dispatches on scheme", () => {
    expect(computeCheck("none", "FS250042")).toBe("");
    expect(computeCheck("luhn", "FS250042")).toBe(luhnDigit("FS250042"));
    expect(computeCheck("mod97", "FS250042")).toBe(mod97Digits("FS250042"));
  });
});
