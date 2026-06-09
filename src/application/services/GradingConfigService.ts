/**
 * GradingConfigService — the SINGLE validated gateway to stored grading
 * configuration (architecture review F-6 / AD4.2).
 *
 * It is the only place that parses the `GradeScale.bands` /
 * `AssessmentConfig.components` JSON columns and the standing-bands setting.
 * Every load routes through the domain value objects (`GradeScale.create`,
 * `AssessmentStructure.create`) and the settings registry, so a misconfigured
 * institution fails LOUDLY at load time (typed error) rather than silently
 * producing a wrong grade or GPA. The engines downstream stay pure (no I/O).
 */
import {
  GradeScale,
  GradeScaleError,
  type GradeBand,
} from "../../domain/value-objects/GradeScale";
import {
  AssessmentStructure,
  AssessmentError,
  type AssessmentComponent,
} from "../../domain/value-objects/AssessmentStructure";
import type { StandingBand } from "../../domain/services/GpaEngine";
import type {
  GradeScaleConfigRepository,
  AssessmentConfigRepository,
} from "../../domain/repositories/grading";
import type { SettingRepository } from "../../domain/repositories/config";
import {
  SettingsRegistry,
  SETTING_KEYS,
} from "../../domain/settings/SettingsRegistry";

export interface GradeScaleRef {
  id?: string;
  name?: string;
}

export class GradingConfigService {
  constructor(
    private readonly gradeScales: GradeScaleConfigRepository,
    private readonly assessments: AssessmentConfigRepository,
    private readonly settings: SettingRepository,
    private readonly registry: SettingsRegistry,
  ) {}

  /**
   * Load a validated GradeScale. Resolves by id, then name, else the default.
   * Throws GradeScaleError if none is configured or the stored bands are invalid.
   */
  async loadGradeScale(ref?: GradeScaleRef): Promise<GradeScale> {
    const row = ref?.id
      ? await this.gradeScales.findById(ref.id)
      : ref?.name
        ? await this.gradeScales.findByName(ref.name)
        : await this.gradeScales.findDefault();

    if (!row) {
      throw new GradeScaleError(
        `No grade scale configured${ref?.id ? ` for id ${ref.id}` : ref?.name ? ` named "${ref.name}"` : " (no default set)"}.`,
      );
    }

    const bands = parseJson<GradeBand[]>(
      row.bands,
      () =>
        new GradeScaleError(
          `Grade scale "${row.name}" has corrupt bands JSON.`,
        ),
    );
    // GradeScale.create performs the real validation (0-100, no gaps/overlaps).
    return GradeScale.create(bands);
  }

  /**
   * Load a validated AssessmentStructure. Resolves by name, else the default.
   * Throws AssessmentError if none is configured or the components are invalid.
   */
  async loadAssessmentStructure(name?: string): Promise<AssessmentStructure> {
    const row = name
      ? await this.assessments.findByName(name)
      : await this.assessments.findDefault();

    if (!row) {
      throw new AssessmentError(
        `No assessment structure configured${name ? ` named "${name}"` : " (no default set)"}.`,
      );
    }

    const components = parseJson<AssessmentComponent[]>(
      row.components,
      () =>
        new AssessmentError(
          `Assessment structure "${row.name}" has corrupt components JSON.`,
        ),
    );
    // AssessmentStructure.create validates (weights sum to 100, unique keys).
    return AssessmentStructure.create(components);
  }

  /** Load the configured academic-standing bands (validated via the registry). */
  async loadStandingBands(): Promise<StandingBand[]> {
    const raw = await this.settings.getRaw(SETTING_KEYS.standingBands);
    const value =
      raw === null
        ? this.registry.defaultValue(SETTING_KEYS.standingBands)
        : this.registry.deserialize(SETTING_KEYS.standingBands, raw);
    return value as StandingBand[];
  }
}

function parseJson<T>(raw: string, onError: () => Error): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw onError();
  }
}
