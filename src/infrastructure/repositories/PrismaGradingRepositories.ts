/**
 * Prisma-backed grading-config repositories — DEV-ONLY adapter (ADR-007;
 * replaced by the Tauri-SQL data layer in Phase 7). Return the raw stored JSON;
 * validation is the GradingConfigService's job.
 */
import type { PrismaClient } from "@prisma/client";
import type {
  GradeScaleConfigRepository,
  AssessmentConfigRepository,
  StoredGradeScale,
  StoredAssessmentConfig,
} from "../../domain/repositories/grading";

type GradeScaleRow = {
  id: string;
  name: string;
  bands: string;
  isDefault: boolean;
};
type AssessmentConfigRow = {
  id: string;
  name: string;
  components: string;
  isDefault: boolean;
};

function toGradeScale(row: GradeScaleRow): StoredGradeScale {
  return {
    id: row.id,
    name: row.name,
    bands: row.bands,
    isDefault: row.isDefault,
  };
}
function toAssessment(row: AssessmentConfigRow): StoredAssessmentConfig {
  return {
    id: row.id,
    name: row.name,
    components: row.components,
    isDefault: row.isDefault,
  };
}

export class PrismaGradeScaleRepository implements GradeScaleConfigRepository {
  constructor(private readonly db: PrismaClient) {}

  async findDefault(): Promise<StoredGradeScale | null> {
    const row = await this.db.gradeScale.findFirst({
      where: { isDefault: true, deletedAt: null },
    });
    return row ? toGradeScale(row) : null;
  }
  async findById(id: string): Promise<StoredGradeScale | null> {
    const row = await this.db.gradeScale.findFirst({
      where: { id, deletedAt: null },
    });
    return row ? toGradeScale(row) : null;
  }
  async findByName(name: string): Promise<StoredGradeScale | null> {
    const row = await this.db.gradeScale.findFirst({
      where: { name, deletedAt: null },
    });
    return row ? toGradeScale(row) : null;
  }
}

export class PrismaAssessmentConfigRepository implements AssessmentConfigRepository {
  constructor(private readonly db: PrismaClient) {}

  async findDefault(): Promise<StoredAssessmentConfig | null> {
    const row = await this.db.assessmentConfig.findFirst({
      where: { isDefault: true, deletedAt: null },
    });
    return row ? toAssessment(row) : null;
  }
  async findByName(name: string): Promise<StoredAssessmentConfig | null> {
    const row = await this.db.assessmentConfig.findFirst({
      where: { name, deletedAt: null },
    });
    return row ? toAssessment(row) : null;
  }
}
