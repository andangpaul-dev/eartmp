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
  async list(): Promise<StoredGradeScale[]> {
    const rows = await this.db.gradeScale.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
    });
    return rows.map(toGradeScale);
  }
  async create(data: Omit<StoredGradeScale, "id">): Promise<StoredGradeScale> {
    const row = await this.db.gradeScale.create({
      data: { name: data.name, bands: data.bands, isDefault: data.isDefault },
    });
    return toGradeScale(row);
  }
  async update(
    id: string,
    patch: Partial<Pick<StoredGradeScale, "name" | "bands">>,
  ): Promise<StoredGradeScale> {
    const row = await this.db.gradeScale.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.bands !== undefined ? { bands: patch.bands } : {}),
      },
    });
    return toGradeScale(row);
  }
  async softDelete(id: string): Promise<void> {
    await this.db.gradeScale.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
  async setDefault(id: string): Promise<void> {
    // Atomic: clear the flag on all other live scales, then set it on `id`.
    await this.db.$transaction([
      this.db.gradeScale.updateMany({
        where: { isDefault: true, deletedAt: null, NOT: { id } },
        data: { isDefault: false },
      }),
      this.db.gradeScale.update({ where: { id }, data: { isDefault: true } }),
    ]);
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
  async findById(id: string): Promise<StoredAssessmentConfig | null> {
    const row = await this.db.assessmentConfig.findFirst({
      where: { id, deletedAt: null },
    });
    return row ? toAssessment(row) : null;
  }
  async findByName(name: string): Promise<StoredAssessmentConfig | null> {
    const row = await this.db.assessmentConfig.findFirst({
      where: { name, deletedAt: null },
    });
    return row ? toAssessment(row) : null;
  }
  async list(): Promise<StoredAssessmentConfig[]> {
    const rows = await this.db.assessmentConfig.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
    });
    return rows.map(toAssessment);
  }
  async create(
    data: Omit<StoredAssessmentConfig, "id">,
  ): Promise<StoredAssessmentConfig> {
    const row = await this.db.assessmentConfig.create({
      data: {
        name: data.name,
        components: data.components,
        isDefault: data.isDefault,
      },
    });
    return toAssessment(row);
  }
  async update(
    id: string,
    patch: Partial<Pick<StoredAssessmentConfig, "name" | "components">>,
  ): Promise<StoredAssessmentConfig> {
    const row = await this.db.assessmentConfig.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.components !== undefined
          ? { components: patch.components }
          : {}),
      },
    });
    return toAssessment(row);
  }
  async softDelete(id: string): Promise<void> {
    await this.db.assessmentConfig.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
  async setDefault(id: string): Promise<void> {
    await this.db.$transaction([
      this.db.assessmentConfig.updateMany({
        where: { isDefault: true, deletedAt: null, NOT: { id } },
        data: { isDefault: false },
      }),
      this.db.assessmentConfig.update({
        where: { id },
        data: { isDefault: true },
      }),
    ]);
  }
}
