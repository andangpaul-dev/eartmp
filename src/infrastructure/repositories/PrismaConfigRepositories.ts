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
    const row = await this.db.institution.findFirst({
      where: { deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
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
