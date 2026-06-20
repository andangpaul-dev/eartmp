import { describe, it, expect } from "vitest";
import {
  expandMatricule,
  admissionYear,
  type MatriculeTokens,
} from "../../src/domain/services/Matricule";
const base: MatriculeTokens = {
  institutionCode: "UB",
  faculty: "FS",
  dept: "CSC",
  year: 2025,
  seq: 42,
  checkScheme: "none",
};
describe("expandMatricule", () => {
  it("expands tokens incl. year2 and padded seq", () => {
    expect(
      expandMatricule("{institutionCode}{faculty}{year2}-{seq:0000}", base),
    ).toBe("UBFS25-0042");
    expect(expandMatricule("{year}/{dept}/{seq}", base)).toBe("2025/CSC/42");
  });
  it("appends a luhn check when {check} present", () => {
    const out = expandMatricule("{faculty}{year2}-{seq:0000}{check}", {
      ...base,
      checkScheme: "luhn",
    });
    expect(out).toMatch(/^FS25-0042\d$/);
  });
  it("parses the admission year from a session name", () => {
    expect(admissionYear("2025/2026")).toBe(2025);
    expect(() => admissionYear("n/a")).toThrow();
  });
});
