import { describe, it, expect } from "vitest";
import {
  validateComponents,
  weightTotal,
  type ComponentRow,
} from "../../src/presentation/screens/grading/componentsValidation";

const ok: ComponentRow[] = [
  { key: "ca", label: "Continuous Assessment", weight: 30, maxScore: 30 },
  { key: "exam", label: "Exam", weight: 70, maxScore: 100 },
];

describe("weightTotal", () => {
  it("sums weights correctly for valid rows", () => {
    expect(weightTotal(ok)).toBe(100);
  });

  it("returns 0 for empty rows", () => {
    expect(weightTotal([])).toBe(0);
  });
});

describe("validateComponents", () => {
  it("returns [] for valid components summing to 100", () => {
    expect(validateComponents(ok)).toEqual([]);
  });

  it("returns error when weights != 100", () => {
    const bad: ComponentRow[] = [
      { key: "ca", label: "CA", weight: 30, maxScore: 30 },
      { key: "exam", label: "Exam", weight: 60, maxScore: 100 },
    ];
    const errs = validateComponents(bad);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.some((e) => /100/.test(e))).toBe(true);
  });

  it("returns error for duplicate keys", () => {
    const bad: ComponentRow[] = [
      { key: "ca", label: "CA", weight: 50, maxScore: 50 },
      { key: "ca", label: "CA Dup", weight: 50, maxScore: 50 },
    ];
    const errs = validateComponents(bad);
    expect(errs.length).toBeGreaterThan(0);
  });

  it("returns error when maxScore <= 0", () => {
    const bad: ComponentRow[] = [
      { key: "ca", label: "CA", weight: 30, maxScore: 0 },
      { key: "exam", label: "Exam", weight: 70, maxScore: 100 },
    ];
    const errs = validateComponents(bad);
    expect(errs.length).toBeGreaterThan(0);
  });

  it("returns error for empty rows", () => {
    const errs = validateComponents([]);
    expect(errs).toEqual(["Add at least one component."]);
  });

  it("returns error when key is empty", () => {
    const bad: ComponentRow[] = [
      { key: "", label: "CA", weight: 30, maxScore: 30 },
      { key: "exam", label: "Exam", weight: 70, maxScore: 100 },
    ];
    const errs = validateComponents(bad);
    expect(errs.length).toBeGreaterThan(0);
  });
});
