/**
 * Branch-coverage tests for the domain engines. These exercise the validation
 * and edge paths (invalid configuration, empty inputs, fallback standing) that
 * the happy-path reference suite does not, keeping the configurable core
 * defensively correct — a misconfigured institution must fail loudly, never
 * silently produce a wrong grade or GPA.
 */
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

describe("GradeScale validation branches", () => {
  it("rejects an empty band set", () => {
    expect(() => GradeScale.create([])).toThrow(GradeScaleError);
  });

  it("rejects a band whose minMark exceeds maxMark", () => {
    expect(() =>
      GradeScale.create([
        { minMark: 60, maxMark: 40, grade: "X", gradePoint: 1, isPass: true },
      ]),
    ).toThrow(/greater than maxMark/);
  });

  it("rejects a band outside 0-100", () => {
    expect(() =>
      GradeScale.create([
        { minMark: 0, maxMark: 120, grade: "X", gradePoint: 1, isPass: true },
      ]),
    ).toThrow(/outside 0-100/);
  });

  it("rejects an invalid (negative/non-finite) grade point", () => {
    expect(() =>
      GradeScale.create([
        { minMark: 0, maxMark: 100, grade: "X", gradePoint: -1, isPass: true },
      ]),
    ).toThrow(/invalid grade point/);
  });

  it("rejects a scale that does not start at 0", () => {
    expect(() =>
      GradeScale.create([
        { minMark: 10, maxMark: 100, grade: "P", gradePoint: 1, isPass: true },
      ]),
    ).toThrow(/start at 0/);
  });

  it("round-trips bands via toBands()", () => {
    const bands = [
      { minMark: 0, maxMark: 49, grade: "F", gradePoint: 0, isPass: false },
      { minMark: 50, maxMark: 100, grade: "P", gradePoint: 1, isPass: true },
    ];
    expect(GradeScale.create(bands).toBands()).toHaveLength(2);
  });
});

describe("AssessmentStructure validation branches", () => {
  it("rejects an empty component set", () => {
    expect(() => AssessmentStructure.create([])).toThrow(AssessmentError);
  });

  it("rejects duplicate component keys", () => {
    expect(() =>
      AssessmentStructure.create([
        { key: "ca", label: "A", weight: 50, maxScore: 100 },
        { key: "ca", label: "B", weight: 50, maxScore: 100 },
      ]),
    ).toThrow(/Duplicate component key/);
  });

  it("rejects a weight outside 0-100", () => {
    expect(() =>
      AssessmentStructure.create([
        { key: "ca", label: "A", weight: 150, maxScore: 100 },
      ]),
    ).toThrow(/weight must be 0-100/);
  });

  it("rejects a non-positive maxScore", () => {
    expect(() =>
      AssessmentStructure.create([
        { key: "ca", label: "A", weight: 100, maxScore: 0 },
      ]),
    ).toThrow(/maxScore must be positive/);
  });

  it("rejects a missing component score", () => {
    const a = AssessmentStructure.create([
      { key: "ca", label: "A", weight: 50, maxScore: 100 },
      { key: "exam", label: "E", weight: 50, maxScore: 100 },
    ]);
    expect(() => a.computeFinalScore([{ key: "ca", score: 80 }])).toThrow(
      /Missing score/,
    );
  });

  it("rejects a negative component score", () => {
    const a = AssessmentStructure.create([
      { key: "ca", label: "A", weight: 100, maxScore: 100 },
    ]);
    expect(() => a.computeFinalScore([{ key: "ca", score: -5 }])).toThrow(
      AssessmentError,
    );
  });

  it("round-trips components via toComponents()", () => {
    const a = AssessmentStructure.create([
      { key: "ca", label: "A", weight: 100, maxScore: 100 },
    ]);
    expect(a.toComponents()).toHaveLength(1);
  });
});

describe("GpaEngine edge branches", () => {
  const scale = GradeScale.create([
    { minMark: 0, maxMark: 49, grade: "F", gradePoint: 0, isPass: false },
    { minMark: 50, maxMark: 100, grade: "P", gradePoint: 4, isPass: true },
  ]);
  const engine = new GpaEngine(scale);

  it("rejects a non-positive credit value", () => {
    expect(() =>
      engine.processSemester([
        { courseCode: "X", creditValue: 0, finalScore: 80 },
      ]),
    ).toThrow(/non-positive credit/);
  });

  it("returns gpa 0 for an empty semester", () => {
    const s = engine.processSemester([]);
    expect(s.gpa).toBe(0);
    expect(s.creditsAttempted).toBe(0);
  });

  it("returns cgpa 0 when no credits were attempted", () => {
    const cum = engine.computeCumulative([engine.processSemester([])]);
    expect(cum.cgpa).toBe(0);
  });

  it("returns 'Unclassified' standing when no bands are configured", () => {
    expect(GpaEngine.resolveStanding(3.5, [])).toBe("Unclassified");
  });

  it("falls back to the lowest band when gpa is below all thresholds", () => {
    const bands = [
      { label: "Distinction", minGpa: 3.5 },
      { label: "Pass", minGpa: 1.0 },
    ];
    expect(GpaEngine.resolveStanding(0.2, bands)).toBe("Pass");
  });
});
