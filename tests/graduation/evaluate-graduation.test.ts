import { describe, it, expect } from "vitest";
import { evaluateGraduation } from "../../src/domain/services/GraduationEligibility";

const reqs = {
  minCgpa: 2.0,
  minCreditsEarned: 120,
  requireNoOutstandingFails: true,
};

describe("evaluateGraduation", () => {
  it("is eligible when all criteria are met", () => {
    const r = evaluateGraduation(
      { cgpa: 3.5, creditsEarned: 120, creditsAttempted: 120 },
      reqs,
    );
    expect(r.eligible).toBe(true);
    expect(r.criteria.every((c) => c.met)).toBe(true);
  });

  it("fails on low CGPA and names the criterion", () => {
    const r = evaluateGraduation(
      { cgpa: 1.5, creditsEarned: 120, creditsAttempted: 120 },
      reqs,
    );
    expect(r.eligible).toBe(false);
    const cgpa = r.criteria.find((c) => c.name === "Minimum CGPA")!;
    expect(cgpa.met).toBe(false);
    expect(cgpa).toMatchObject({ required: 2.0, actual: 1.5 });
  });

  it("fails on insufficient credits", () => {
    const r = evaluateGraduation(
      { cgpa: 3.0, creditsEarned: 90, creditsAttempted: 90 },
      reqs,
    );
    expect(r.eligible).toBe(false);
    expect(
      r.criteria.find((c) => c.name === "Minimum credits earned")!.met,
    ).toBe(false);
  });

  it("fails on outstanding fails (attempted > earned)", () => {
    const r = evaluateGraduation(
      { cgpa: 3.0, creditsEarned: 118, creditsAttempted: 120 },
      reqs,
    );
    expect(r.eligible).toBe(false);
    const noFails = r.criteria.find(
      (c) => c.name === "No outstanding fails (credits)",
    )!;
    expect(noFails).toMatchObject({ actual: 2, met: false });
  });

  it("omits the no-fails criterion when not required", () => {
    const r = evaluateGraduation(
      // 122 attempted vs 120 earned would be an "outstanding fail", but the
      // rule is off — so it's omitted and the student is eligible.
      { cgpa: 3.0, creditsEarned: 120, creditsAttempted: 122 },
      { ...reqs, requireNoOutstandingFails: false },
    );
    expect(r.criteria.some((c) => c.name.includes("outstanding"))).toBe(false);
    expect(r.eligible).toBe(true);
  });
});
