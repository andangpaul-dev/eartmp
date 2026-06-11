import { describe, it, expect } from "vitest";
import {
  summarizeSemester,
  summarizeCumulative,
} from "../../src/domain/services/AcademicSummary";

describe("summarizeSemester", () => {
  it("computes a credit-weighted GPA", () => {
    const s = summarizeSemester("sem1", [
      { creditValue: 3, gradePoint: 4, creditsEarned: 3 },
      { creditValue: 2, gradePoint: 3, creditsEarned: 2 },
    ]);
    // (12 + 6) / 5 = 3.6
    expect(s.gpa).toBe(3.6);
    expect(s.creditsAttempted).toBe(5);
    expect(s.creditsEarned).toBe(5);
    expect(s.qualityPoints).toBe(18);
  });

  it("returns 0 for zero credits (no divide-by-zero)", () => {
    expect(summarizeSemester("x", []).gpa).toBe(0);
  });
});

describe("summarizeCumulative (aggregate, NOT mean)", () => {
  it("computes CGPA over aggregate quality points/credits", () => {
    const s1 = summarizeSemester("s1", [
      { creditValue: 4, gradePoint: 4, creditsEarned: 4 }, // 16 quality
    ]);
    const s2 = summarizeSemester("s2", [
      { creditValue: 1, gradePoint: 1, creditsEarned: 1 }, // 1 quality
    ]);
    const cum = summarizeCumulative([s1, s2]);
    // Aggregate: 17 / 5 = 3.4 — a MEAN of GPAs would be (4 + 1) / 2 = 2.5.
    expect(cum.cgpa).toBe(3.4);
    expect(cum.cgpa).not.toBe(2.5);
    expect(cum.creditsAttempted).toBe(5);
  });

  it("returns 0 cgpa when no credits", () => {
    expect(summarizeCumulative([]).cgpa).toBe(0);
  });
});
