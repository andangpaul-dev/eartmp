import { describe, it, expect } from "vitest";
import { validateBands } from "../../src/presentation/screens/grading/bandsValidation";
import type { BandRow } from "../../src/presentation/screens/grading/bandsValidation";

function band(
  minMark: number,
  maxMark: number,
  grade: string,
  gradePoint = 4,
  isPass = true,
): BandRow {
  return { minMark, maxMark, grade, gradePoint, isPass };
}

describe("validateBands", () => {
  it("returns [] for a full 0-100 contiguous coverage", () => {
    const rows: BandRow[] = [
      band(0, 39, "F", 0, false),
      band(40, 49, "D", 1),
      band(50, 59, "C", 2),
      band(60, 69, "B", 3),
      band(70, 100, "A", 4),
    ];
    expect(validateBands(rows)).toEqual([]);
  });

  it("reports a gap between bands", () => {
    const rows: BandRow[] = [
      band(0, 49, "F", 0, false),
      // gap: 51 starts instead of 50
      band(51, 100, "A", 4),
    ];
    const errs = validateBands(rows);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.join(" ")).toMatch(/gap|cover/i);
  });

  it("reports an overlap between bands", () => {
    const rows: BandRow[] = [
      band(0, 60, "F", 0, false),
      band(50, 100, "A", 4), // overlaps with previous
    ];
    const errs = validateBands(rows);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.join(" ")).toMatch(/overlap/i);
  });

  it("reports when marks are out of range (> 100)", () => {
    const rows: BandRow[] = [
      band(0, 110, "A", 4), // maxMark > 100
    ];
    const errs = validateBands(rows);
    expect(errs.length).toBeGreaterThan(0);
  });

  it("reports when minMark > maxMark", () => {
    const rows: BandRow[] = [
      band(80, 20, "A", 4), // min > max
    ];
    const errs = validateBands(rows);
    expect(errs.length).toBeGreaterThan(0);
  });

  it("reports a negative grade point", () => {
    const rows: BandRow[] = [band(0, 100, "A", -1)];
    const errs = validateBands(rows);
    expect(errs.length).toBeGreaterThan(0);
  });

  it("returns an error when no bands are provided", () => {
    const errs = validateBands([]);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatch(/add at least one/i);
  });

  it("requires bands to start at 0", () => {
    const rows: BandRow[] = [band(1, 100, "A", 4)];
    const errs = validateBands(rows);
    expect(errs.join(" ")).toMatch(/start at 0/i);
  });

  it("requires bands to cover up to 100", () => {
    const rows: BandRow[] = [band(0, 99, "A", 4)];
    const errs = validateBands(rows);
    expect(errs.join(" ")).toMatch(/cover up to 100/i);
  });

  it("requires grade to be non-empty", () => {
    const rows: BandRow[] = [
      band(0, 100, "  ", 4), // blank grade
    ];
    const errs = validateBands(rows);
    expect(errs.join(" ")).toMatch(/grade is required/i);
  });
});
