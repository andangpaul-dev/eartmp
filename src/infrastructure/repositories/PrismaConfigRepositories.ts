/**
 * Prisma-backed config repositories — DEV-ONLY adapter (ADR-007; replaced by
 * the Tauri-SQL data layer in Phase 7). Maps Prisma rows to domain types.
 */
import type { PrismaClient } from "@prisma/client";
import type {
  Institution,
  CalendarType,
} from "../../domain/entities/institution";
import { InstitutionError } from "../../domain/errors/config";
import type {
  InstitutionRepository,
  SettingRepository,
} from "../../domain/repositories/config";

type InstitutionRow = {
  id: string;
  name: string;
  code: string | null;
  isDefault: boolean;
  motto: string | null;
  accreditationNo: string | null;
  address: string | null;
  telephone: string | null;
  email: string | null;
  website: string | null;
  logoPath: string | null;
  sealPath: string | null;
  registrarSignPath: string | null;
  calendarType: string;
  transcriptNumberRule: string | null;
};

function toInstitution(row: InstitutionRow): Institution {
  return {
    id: row.id,
    name: row.name,
    code: row.code ?? undefined,
    isDefault: row.isDefault,
    motto: row.motto ?? undefined,
    accreditationNo: row.accreditationNo ?? undefined,
    address: row.address ?? undefined,
    telephone: row.telephone ?? undefined,
    email: row.email ?? undefined,
    website: row.website ?? undefined,
    logoPath: row.logoPath ?? undefined,
    sealPath: row.sealPath ?? undefined,
    registrarSignPath: row.registrarSignPath ?? undefined,
    calendarType: row.calendarType as CalendarType,
    transcriptNumberRule: row.transcriptNumberRule ?? undefined,
  };
}

export class PrismaInstitutionRepository implements InstitutionRepository {
  constructor(private readonly db: PrismaClient) {}

  async get(): Promise<Institution | null> {
    // The default institution drives transcripts; fall back to the earliest.
    const row =
      (await this.db.institution.findFirst({
        where: { isDefault: true, deletedAt: null },
      })) ??
      (await this.db.institution.findFirst({
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
      }));
    return row ? toInstitution(row) : null;
  }

  async update(patch: Partial<Institution>): Promise<Institution> {
    const current = await this.db.institution.findFirst({
      where: { deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    if (!current) {
      throw new InstitutionError("Institution is not provisioned.");
    }
    const row = await this.db.institution.update({
      where: { id: current.id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.motto !== undefined ? { motto: patch.motto } : {}),
        ...(patch.accreditationNo !== undefined
          ? { accreditationNo: patch.accreditationNo }
          : {}),
        ...(patch.address !== undefined ? { address: patch.address } : {}),
        ...(patch.telephone !== undefined
          ? { telephone: patch.telephone }
          : {}),
        ...(patch.email !== undefined ? { email: patch.email } : {}),
        ...(patch.website !== undefined ? { website: patch.website } : {}),
        ...(patch.logoPath !== undefined ? { logoPath: patch.logoPath } : {}),
        ...(patch.sealPath !== undefined ? { sealPath: patch.sealPath } : {}),
        ...(patch.registrarSignPath !== undefined
          ? { registrarSignPath: patch.registrarSignPath }
          : {}),
        ...(patch.calendarType !== undefined
          ? { calendarType: patch.calendarType }
          : {}),
        ...(patch.transcriptNumberRule !== undefined
          ? { transcriptNumberRule: patch.transcriptNumberRule }
          : {}),
      },
    });
    return toInstitution(row);
  }

  // --- multi-institution management ---

  private writeData(patch: Partial<Institution>): Record<string, unknown> {
    const keys: (keyof Institution)[] = [
      "name",
      "code",
      "isDefault",
      "motto",
      "accreditationNo",
      "address",
      "telephone",
      "email",
      "website",
      "logoPath",
      "sealPath",
      "registrarSignPath",
      "calendarType",
      "transcriptNumberRule",
    ];
    const data: Record<string, unknown> = {};
    for (const k of keys) if (patch[k] !== undefined) data[k] = patch[k];
    return data;
  }

  async list(): Promise<Institution[]> {
    const rows = await this.db.institution.findMany({
      where: { deletedAt: null },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
    return rows.map(toInstitution);
  }

  async findById(id: string): Promise<Institution | null> {
    const row = await this.db.institution.findFirst({
      where: { id, deletedAt: null },
    });
    return row ? toInstitution(row) : null;
  }

  async create(
    data: Partial<Institution> & { name: string },
  ): Promise<Institution> {
    const isFirst =
      (await this.db.institution.count({
        where: { deletedAt: null },
      })) === 0;
    const row = await this.db.institution.create({
      data: {
        ...this.writeData(data),
        name: data.name,
        // The very first institution becomes the default automatically.
        isDefault: data.isDefault ?? isFirst,
        calendarType: data.calendarType ?? "SEMESTER",
      },
    });
    return toInstitution(row);
  }

  async updateById(
    id: string,
    patch: Partial<Institution>,
  ): Promise<Institution> {
    const row = await this.db.institution.update({
      where: { id },
      data: this.writeData(patch),
    });
    return toInstitution(row);
  }

  async softDelete(id: string): Promise<void> {
    await this.db.institution.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async setDefault(id: string): Promise<void> {
    await this.db.$transaction([
      this.db.institution.updateMany({
        where: { isDefault: true, deletedAt: null },
        data: { isDefault: false },
      }),
      this.db.institution.update({ where: { id }, data: { isDefault: true } }),
    ]);
  }

  async countLiveFaculties(institutionId: string): Promise<number> {
    return this.db.faculty.count({
      where: { institutionId, deletedAt: null },
    });
  }
}

export class PrismaSettingRepository implements SettingRepository {
  constructor(private readonly db: PrismaClient) {}

  async getRaw(key: string): Promise<string | null> {
    const row = await this.db.setting.findFirst({
      where: { key, deletedAt: null },
    });
    return row ? row.value : null;
  }

  async setRaw(key: string, raw: string): Promise<void> {
    await this.db.setting.upsert({
      where: { key },
      update: { value: raw },
      create: { key, value: raw },
    });
  }

  async all(): Promise<{ key: string; value: string }[]> {
    const rows = await this.db.setting.findMany({ where: { deletedAt: null } });
    return rows.map((r) => ({ key: r.key, value: r.value }));
  }
}
