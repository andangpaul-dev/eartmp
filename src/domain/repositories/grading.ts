/**
 * Read ports for stored grading configuration (grade scales + assessment
 * structures). They return the RAW stored JSON; validation into value objects
 * is the GradingConfigService's job (single choke point, F-6).
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
}

export interface AssessmentConfigRepository {
  findDefault(): Promise<StoredAssessmentConfig | null>;
  findByName(name: string): Promise<StoredAssessmentConfig | null>;
}
