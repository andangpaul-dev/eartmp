import { describe, it, expect } from "vitest";
import {
  GradeScale,
  GradeScaleError,
} from "../src/domain/value-objects/GradeScale";
import {
  AssessmentStructure,
  AssessmentError,
} from "../src/domain/value-objects/AssessmentStructure";
import { GpaEngine } from "../src/domain/services/GpaEngine";

// A standard scale matching the spec example.
const standardBands = [
  { minMark: 80, maxMark: 100, grade: "A", gradePoint: 4.0, isPass: true },
  { minMark: 70, maxMark: 79, grade: "B+", gradePoint: 3.5, isPass: true },
  { minMark: 60, maxMark: 69, grade: "B", gradePoint: 3.0, isPass: true },
  { minMark: 50, maxMark: 59, grade: "C+", gradePoint: 2.5, isPass: true },
  { minMark: 45, maxMark: 49, grade: "C", gradePoint: 2.0, isPass: true },
  { minMark: 40, maxMark: 44, grade: "D", gradePoint: 1.0, isPass: true },
  { minMark: 0, maxMark: 39, grade: "F", gradePoint: 0.0, isPass: false },
];

describe("GradeScale", () => {
  const scale = GradeScale.create(standardBands);

  it("resolves marks to the correct grade at band edges", () => {
    expect(scale.resolve(100).grade).toBe("A");
    expect(scale.resolve(80).grade).toBe("A");
    expect(scale.resolve(79).grade).toBe("B+");
    expect(scale.resolve(45).grade).toBe("C");
    expect(scale.resolve(44).grade).toBe("D");
    expect(scale.resolve(39).grade).toBe("F");
    expect(scale.resolve(0).grade).toBe("F");
  });

  it("marks F as a non-pass and others as pass", () => {
    expect(scale.resolve(39).isPass).toBe(false);
    expect(scale.resolve(40).isPass).toBe(true);
  });

  it("rejects out-of-range marks", () => {
    expect(() => scale.resolve(101)).toThrow(GradeScaleError);
    expect(() => scale.resolve(-1)).toThrow(GradeScaleError);
  });

  it("rejects a scale with a gap", () => {
    const withGap = standardBands.filter((b) => b.grade !== "D");
    expect(() => GradeScale.create(withGap)).toThrow(/Gap/);
  });

  it("rejects overlapping bands", () => {
    const overlap = [
      { minMark: 0, maxMark: 60, grade: "F", gradePoint: 0, isPass: false },
      { minMark: 50, maxMark: 100, grade: "P", gradePoint: 4, isPass: true },
    ];
    expect(() => GradeScale.create(overlap)).toThrow(/overlap/);
  });

  it("rejects a scale that does not cover 0-100", () => {
    const partial = [
      { minMark: 0, maxMark: 50, grade: "F", gradePoint: 0, isPass: false },
      { minMark: 51, maxMark: 90, grade: "P", gradePoint: 4, isPass: true },
    ];
    expect(() => GradeScale.create(partial)).toThrow(/end at 100/);
  });

  it("supports an entirely different institution scale", () => {
    // A simple pass/fail scale — proves no hardcoding.
    const pf = GradeScale.create([
      { minMark: 0, maxMark: 49, grade: "FAIL", gradePoint: 0, isPass: false },
      { minMark: 50, maxMark: 100, grade: "PASS", gradePoint: 1, isPass: true },
    ]);
    expect(pf.resolve(75).grade).toBe("PASS");
    expect(pf.resolve(20).grade).toBe("FAIL");
  });
});

describe("AssessmentStructure", () => {
  it("computes a weighted final score (CA 30 / Exam 70)", () => {
    const a = AssessmentStructure.create([
      { key: "ca", label: "Continuous Assessment", weight: 30, maxScore: 30 },
      { key: "exam", label: "Examination", weight: 70, maxScore: 70 },
    ]);
    // Full CA, half exam: 30 + 35 = 65
    const score = a.computeFinalScore([
      { key: "ca", score: 30 },
      { key: "exam", score: 35 },
    ]);
    expect(score).toBe(65);
  });

  it("supports a multi-component structure", () => {
    const a = AssessmentStructure.create([
      { key: "assignment", label: "Assignment", weight: 10, maxScore: 100 },
      { key: "quiz", label: "Quiz", weight: 10, maxScore: 100 },
      { key: "midterm", label: "Midterm", weight: 20, maxScore: 100 },
      { key: "exam", label: "Exam", weight: 60, maxScore: 100 },
    ]);
    const score = a.computeFinalScore([
      { key: "assignment", score: 100 },
      { key: "quiz", score: 100 },
      { key: "midterm", score: 100 },
      { key: "exam", score: 100 },
    ]);
    expect(score).toBe(100);
  });

  it("rejects weights that do not sum to 100", () => {
    expect(() =>
      AssessmentStructure.create([
        { key: "ca", label: "CA", weight: 40, maxScore: 100 },
        { key: "exam", label: "Exam", weight: 70, maxScore: 100 },
      ]),
    ).toThrow(AssessmentError);
  });

  it("rejects a score above its component max", () => {
    const a = AssessmentStructure.create([
      { key: "exam", label: "Exam", weight: 100, maxScore: 70 },
    ]);
    expect(() => a.computeFinalScore([{ key: "exam", score: 71 }])).toThrow(
      AssessmentError,
    );
  });
});

describe("GpaEngine", () => {
  const scale = GradeScale.create(standardBands);
  const engine = new GpaEngine(scale);

  it("computes credit-weighted semester GPA", () => {
    const summary = engine.processSemester([
      { courseCode: "CS101", creditValue: 3, finalScore: 85 }, // A 4.0 -> 12
      { courseCode: "MA101", creditValue: 2, finalScore: 72 }, // B+ 3.5 -> 7
      { courseCode: "PH101", creditValue: 1, finalScore: 30 }, // F 0.0 -> 0
    ]);
    expect(summary.creditsAttempted).toBe(6);
    expect(summary.creditsEarned).toBe(5); // PH101 failed
    expect(summary.totalQualityPoints).toBe(19);
    expect(summary.gpa).toBeCloseTo(3.17, 2); // 19/6
  });

  it("computes cumulative GPA across semesters by aggregate, not mean", () => {
    const s1 = engine.processSemester([
      { courseCode: "A", creditValue: 4, finalScore: 85 }, // 4.0 * 4 = 16
    ]);
    const s2 = engine.processSemester([
      { courseCode: "B", creditValue: 1, finalScore: 40 }, // 1.0 * 1 = 1
    ]);
    const cum = engine.computeCumulative([s1, s2]);
    // Aggregate: 17 quality / 5 credits = 3.4 (mean of GPAs would be 2.5)
    expect(cum.cgpa).toBe(3.4);
    expect(cum.creditsEarned).toBe(5);
  });

  it("resolves academic standing from configurable bands", () => {
    const bands = [
      { label: "First Class", minGpa: 3.5 },
      { label: "Second Class Upper", minGpa: 3.0 },
      { label: "Second Class Lower", minGpa: 2.0 },
      { label: "Pass", minGpa: 1.0 },
      { label: "Fail", minGpa: 0 },
    ];
    expect(GpaEngine.resolveStanding(3.8, bands)).toBe("First Class");
    expect(GpaEngine.resolveStanding(3.0, bands)).toBe("Second Class Upper");
    expect(GpaEngine.resolveStanding(0.5, bands)).toBe("Fail");
  });
});
