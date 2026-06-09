/**
 * AssessmentStructure — a configurable set of weighted components that
 * combine into a final score (e.g. CA 30% + Exam 70%, or Quiz/Midterm/Exam).
 *
 * The spec requires assessment types to be dynamic, so components are supplied
 * at runtime. Weights must sum to 100.
 */

export interface AssessmentComponent {
  readonly key: string; // stable identifier, e.g. "ca", "exam"
  readonly label: string; // human label, e.g. "Continuous Assessment"
  readonly weight: number; // percentage contribution, 0-100
  readonly maxScore: number; // the raw scale this component is marked out of
}

export interface ComponentScore {
  readonly key: string;
  readonly score: number; // raw score, 0..maxScore
}

export class AssessmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssessmentError";
  }
}

export class AssessmentStructure {
  private readonly components: ReadonlyArray<AssessmentComponent>;

  private constructor(components: ReadonlyArray<AssessmentComponent>) {
    this.components = components;
  }

  static create(components: AssessmentComponent[]): AssessmentStructure {
    if (components.length === 0) {
      throw new AssessmentError("At least one assessment component is required.");
    }

    const keys = new Set<string>();
    for (const c of components) {
      if (keys.has(c.key)) {
        throw new AssessmentError(`Duplicate component key "${c.key}".`);
      }
      keys.add(c.key);
      if (c.weight < 0 || c.weight > 100) {
        throw new AssessmentError(`Component "${c.key}" weight must be 0-100.`);
      }
      if (c.maxScore <= 0) {
        throw new AssessmentError(`Component "${c.key}" maxScore must be positive.`);
      }
    }

    const total = components.reduce((sum, c) => sum + c.weight, 0);
    // Allow tiny floating-point drift.
    if (Math.abs(total - 100) > 1e-6) {
      throw new AssessmentError(`Component weights must sum to 100 (got ${total}).`);
    }

    return new AssessmentStructure(components);
  }

  /**
   * Combine raw component scores into a final percentage (0-100).
   * Every defined component must have a supplied score.
   */
  computeFinalScore(scores: ComponentScore[]): number {
    const byKey = new Map(scores.map((s) => [s.key, s.score]));

    let final = 0;
    for (const c of this.components) {
      const raw = byKey.get(c.key);
      if (raw === undefined) {
        throw new AssessmentError(`Missing score for component "${c.key}".`);
      }
      if (raw < 0 || raw > c.maxScore) {
        throw new AssessmentError(
          `Score ${raw} for "${c.key}" is outside 0-${c.maxScore}.`,
        );
      }
      // Normalise raw score to its weighted contribution.
      final += (raw / c.maxScore) * c.weight;
    }

    // Round to 2 decimal places to avoid floating noise.
    return Math.round(final * 100) / 100;
  }

  toComponents(): AssessmentComponent[] {
    return [...this.components];
  }
}
