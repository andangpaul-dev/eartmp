/**
 * GradeScale — a fully configurable grading rule set.
 *
 * The spec demands "no hardcoded grading rules". Every band (mark range ->
 * grade -> grade point) is supplied at runtime by an administrator and stored
 * in the database. This value object validates the configuration and resolves
 * a raw mark into a grade.
 */

export interface GradeBand {
  readonly minMark: number; // inclusive
  readonly maxMark: number; // inclusive
  readonly grade: string; // e.g. "A", "B+"
  readonly gradePoint: number; // e.g. 4.0
  /** Whether this band counts as a pass for credit-earning purposes. */
  readonly isPass: boolean;
}

export interface GradeResult {
  readonly grade: string;
  readonly gradePoint: number;
  readonly isPass: boolean;
}

export class GradeScaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GradeScaleError";
  }
}

export class GradeScale {
  private readonly bands: ReadonlyArray<GradeBand>;

  private constructor(bands: ReadonlyArray<GradeBand>) {
    this.bands = bands;
  }

  /**
   * Build and validate a scale. Throws GradeScaleError if the configuration
   * is internally inconsistent (gaps, overlaps, inverted ranges, etc.).
   */
  static create(bands: GradeBand[]): GradeScale {
    if (bands.length === 0) {
      throw new GradeScaleError(
        "A grade scale must contain at least one band.",
      );
    }

    for (const b of bands) {
      if (b.minMark > b.maxMark) {
        throw new GradeScaleError(
          `Band "${b.grade}" has minMark (${b.minMark}) greater than maxMark (${b.maxMark}).`,
        );
      }
      if (b.minMark < 0 || b.maxMark > 100) {
        throw new GradeScaleError(
          `Band "${b.grade}" range ${b.minMark}-${b.maxMark} falls outside 0-100.`,
        );
      }
      if (!Number.isFinite(b.gradePoint) || b.gradePoint < 0) {
        throw new GradeScaleError(
          `Band "${b.grade}" has an invalid grade point.`,
        );
      }
    }

    const sorted = [...bands].sort((a, b) => a.minMark - b.minMark);

    // Detect overlaps and gaps across the full 0-100 span.
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i]!;
      const next = sorted[i + 1]!;
      if (current.maxMark >= next.minMark) {
        throw new GradeScaleError(
          `Bands "${current.grade}" (${current.minMark}-${current.maxMark}) and ` +
            `"${next.grade}" (${next.minMark}-${next.maxMark}) overlap.`,
        );
      }
      if (next.minMark - current.maxMark > 1) {
        throw new GradeScaleError(
          `Gap in scale between ${current.maxMark} and ${next.minMark}. ` +
            `Marks in this range cannot be graded.`,
        );
      }
    }

    if (sorted[0]!.minMark !== 0) {
      throw new GradeScaleError("Grade scale must start at 0.");
    }
    if (sorted[sorted.length - 1]!.maxMark !== 100) {
      throw new GradeScaleError("Grade scale must end at 100.");
    }

    return new GradeScale(sorted);
  }

  /** Resolve a raw mark (0-100) into its grade. */
  resolve(mark: number): GradeResult {
    if (mark < 0 || mark > 100 || !Number.isFinite(mark)) {
      throw new GradeScaleError(`Mark ${mark} is out of the 0-100 range.`);
    }
    const band = this.bands.find((b) => mark >= b.minMark && mark <= b.maxMark);
    if (!band) {
      // Should be impossible given validation, but guard anyway.
      throw new GradeScaleError(`No grade band matches mark ${mark}.`);
    }
    return {
      grade: band.grade,
      gradePoint: band.gradePoint,
      isPass: band.isPass,
    };
  }

  toBands(): GradeBand[] {
    return [...this.bands];
  }
}
