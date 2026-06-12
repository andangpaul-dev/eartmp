/**
 * Graduation eligibility (Phase 16). Pure evaluation of a student's academic
 * summary against configurable requirements (AD16.2). Every criterion is
 * transparent (required vs actual vs met), so a rejection always explains itself
 * (AD16.5). No I/O — fully unit-testable.
 */

export interface GraduationRequirements {
  minCgpa: number;
  minCreditsEarned: number;
  requireNoOutstandingFails: boolean;
}

export interface Criterion {
  name: string;
  required: string | number;
  actual: string | number;
  met: boolean;
}

export interface EligibilityReport {
  eligible: boolean;
  criteria: Criterion[];
}

/** The slice of the Phase 11 AcademicSummary the evaluator needs. */
export interface GraduationSummary {
  cgpa: number;
  creditsEarned: number;
  creditsAttempted: number;
}

export function evaluateGraduation(
  summary: GraduationSummary,
  req: GraduationRequirements,
): EligibilityReport {
  const criteria: Criterion[] = [
    {
      name: "Minimum CGPA",
      required: req.minCgpa,
      actual: summary.cgpa,
      met: summary.cgpa >= req.minCgpa,
    },
    {
      name: "Minimum credits earned",
      required: req.minCreditsEarned,
      actual: summary.creditsEarned,
      met: summary.creditsEarned >= req.minCreditsEarned,
    },
  ];

  if (req.requireNoOutstandingFails) {
    const outstanding = summary.creditsAttempted - summary.creditsEarned;
    criteria.push({
      name: "No outstanding fails (credits)",
      required: 0,
      actual: outstanding,
      met: outstanding === 0,
    });
  }

  return { eligible: criteria.every((c) => c.met), criteria };
}
