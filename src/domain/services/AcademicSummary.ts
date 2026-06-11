/**
 * AcademicSummary — pure aggregation of a student's PROCESSED course grade
 * points into per-semester and cumulative summaries (Phase 11).
 *
 * It sums the stored `gradePoint × creditValue` (quality points) — it does NOT
 * re-grade from raw scores (AD11.1), so a later grade-scale change never rewrites
 * history. CGPA is computed over aggregate quality points / credits, never as a
 * mean of semester GPAs (ADR-004 / AD11.2). No I/O — fully unit-testable.
 */

export interface CourseGradePoint {
  creditValue: number;
  gradePoint: number;
  creditsEarned: number;
}

export interface SemesterSummary {
  semesterId: string;
  creditsAttempted: number;
  creditsEarned: number;
  qualityPoints: number;
  gpa: number; // rounded to 2dp
}

export interface CumulativeSummary {
  creditsAttempted: number;
  creditsEarned: number;
  totalQualityPoints: number;
  cgpa: number; // rounded to 2dp
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export function summarizeSemester(
  semesterId: string,
  items: CourseGradePoint[],
): SemesterSummary {
  const creditsAttempted = items.reduce((s, i) => s + i.creditValue, 0);
  const creditsEarned = items.reduce((s, i) => s + i.creditsEarned, 0);
  const qualityPoints = items.reduce(
    (s, i) => s + i.gradePoint * i.creditValue,
    0,
  );
  const gpa =
    creditsAttempted === 0 ? 0 : round2(qualityPoints / creditsAttempted);
  return { semesterId, creditsAttempted, creditsEarned, qualityPoints, gpa };
}

export function summarizeCumulative(
  semesters: SemesterSummary[],
): CumulativeSummary {
  const creditsAttempted = semesters.reduce(
    (s, x) => s + x.creditsAttempted,
    0,
  );
  const creditsEarned = semesters.reduce((s, x) => s + x.creditsEarned, 0);
  const totalQualityPoints = semesters.reduce((s, x) => s + x.qualityPoints, 0);
  // Aggregate, NOT a mean of per-semester GPAs.
  const cgpa =
    creditsAttempted === 0 ? 0 : round2(totalQualityPoints / creditsAttempted);
  return { creditsAttempted, creditsEarned, totalQualityPoints, cgpa };
}
