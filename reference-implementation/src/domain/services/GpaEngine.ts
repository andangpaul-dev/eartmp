import { GradeScale } from "../value-objects/GradeScale";

/**
 * GpaEngine — computes credit-weighted GPA and academic standing.
 *
 * GPA uses the standard credit-weighted mean:
 *   GPA = sum(gradePoint * creditValue) / sum(creditValue)
 *
 * Standing thresholds are configurable per the spec ("rules must be
 * configurable").
 */

export interface CourseResult {
  readonly courseCode: string;
  readonly creditValue: number;
  readonly finalScore: number; // 0-100
}

export interface ProcessedCourseResult extends CourseResult {
  readonly grade: string;
  readonly gradePoint: number;
  readonly isPass: boolean;
  readonly creditsEarned: number; // creditValue if pass, else 0
  readonly qualityPoints: number; // gradePoint * creditValue
}

export interface GpaSummary {
  readonly courses: ProcessedCourseResult[];
  readonly creditsAttempted: number;
  readonly creditsEarned: number;
  readonly totalQualityPoints: number;
  readonly gpa: number; // rounded to 2dp
}

/** A standing band, e.g. { label: "First Class", minGpa: 3.5 }. */
export interface StandingBand {
  readonly label: string;
  readonly minGpa: number; // inclusive lower bound
}

export class GpaEngine {
  constructor(private readonly scale: GradeScale) {}

  /** Process a set of course results for one semester. */
  processSemester(results: CourseResult[]): GpaSummary {
    const courses: ProcessedCourseResult[] = results.map((r) => {
      if (r.creditValue <= 0) {
        throw new Error(`Course ${r.courseCode} has a non-positive credit value.`);
      }
      const { grade, gradePoint, isPass } = this.scale.resolve(r.finalScore);
      return {
        ...r,
        grade,
        gradePoint,
        isPass,
        creditsEarned: isPass ? r.creditValue : 0,
        qualityPoints: gradePoint * r.creditValue,
      };
    });

    const creditsAttempted = courses.reduce((s, c) => s + c.creditValue, 0);
    const creditsEarned = courses.reduce((s, c) => s + c.creditsEarned, 0);
    const totalQualityPoints = courses.reduce((s, c) => s + c.qualityPoints, 0);

    const gpa =
      creditsAttempted === 0
        ? 0
        : Math.round((totalQualityPoints / creditsAttempted) * 100) / 100;

    return { courses, creditsAttempted, creditsEarned, totalQualityPoints, gpa };
  }

  /**
   * Combine multiple semester summaries into a cumulative GPA.
   * CGPA is computed over the aggregate quality points and credits, not as a
   * mean of semester GPAs (which would be incorrect for uneven credit loads).
   */
  computeCumulative(summaries: GpaSummary[]): {
    creditsAttempted: number;
    creditsEarned: number;
    cgpa: number;
  } {
    const creditsAttempted = summaries.reduce((s, x) => s + x.creditsAttempted, 0);
    const creditsEarned = summaries.reduce((s, x) => s + x.creditsEarned, 0);
    const totalQuality = summaries.reduce((s, x) => s + x.totalQualityPoints, 0);
    const cgpa =
      creditsAttempted === 0
        ? 0
        : Math.round((totalQuality / creditsAttempted) * 100) / 100;
    return { creditsAttempted, creditsEarned, cgpa };
  }

  /** Resolve academic standing from configurable bands. */
  static resolveStanding(gpa: number, bands: StandingBand[]): string {
    if (bands.length === 0) return "Unclassified";
    const sorted = [...bands].sort((a, b) => b.minGpa - a.minGpa);
    const match = sorted.find((b) => gpa >= b.minGpa);
    return match ? match.label : sorted[sorted.length - 1]!.label;
  }
}
