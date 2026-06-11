/**
 * Ports for stored grading configuration (grade scales + assessment structures).
 * Reads return the RAW stored JSON; validation into value objects is done by the
 * GradingConfigService on read (F-6) and by the Phase 8 use-cases on write
 * (AD8.1) — invalid config can enter from neither direction. `name` is unique
 * among LIVE rows (catalog `@unique`).
 */

export interface StoredGradeScale {
  id: string;
  name: string;
  bands: string; // JSON: [{minMark,maxMark,grade,gradePoint,isPass}]
  isDefault: boolean;
}

export interface StoredAssessmentConfig {
  id: string;
  name: string;
  components: string; // JSON: [{key,label,weight,maxScore}]
  isDefault: boolean;
}

export interface GradeScaleConfigRepository {
  findDefault(): Promise<StoredGradeScale | null>;
  findById(id: string): Promise<StoredGradeScale | null>;
  findByName(name: string): Promise<StoredGradeScale | null>;
  list(): Promise<StoredGradeScale[]>;
  create(data: Omit<StoredGradeScale, "id">): Promise<StoredGradeScale>;
  update(
    id: string,
    patch: Partial<Pick<StoredGradeScale, "name" | "bands">>,
  ): Promise<StoredGradeScale>;
  softDelete(id: string): Promise<void>;
  /** Make `id` the default and clear the flag on all other live scales. */
  setDefault(id: string): Promise<void>;
}

export interface AssessmentConfigRepository {
  findDefault(): Promise<StoredAssessmentConfig | null>;
  findById(id: string): Promise<StoredAssessmentConfig | null>;
  findByName(name: string): Promise<StoredAssessmentConfig | null>;
  list(): Promise<StoredAssessmentConfig[]>;
  create(
    data: Omit<StoredAssessmentConfig, "id">,
  ): Promise<StoredAssessmentConfig>;
  update(
    id: string,
    patch: Partial<Pick<StoredAssessmentConfig, "name" | "components">>,
  ): Promise<StoredAssessmentConfig>;
  softDelete(id: string): Promise<void>;
  setDefault(id: string): Promise<void>;
}
