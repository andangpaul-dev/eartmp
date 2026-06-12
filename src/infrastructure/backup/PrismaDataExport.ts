/**
 * PrismaDataExport — DEV-ONLY DataExportPort over Prisma (ADR-007). `exportAll`
 * dumps every table; `importAll` replaces all data inside one `$transaction`
 * (atomic, AD17.3): delete children→parents, then insert parents→children.
 * The shell's Tauri-SQL impl can swap to a physical DB-file copy.
 *
 * NOTE: generic table handling uses dynamic delegate access; date/JSON columns
 * round-trip as the values Prisma returns. The real on-disk backup (file copy +
 * SQLCipher) is the shell concern — this dev impl proves the engine.
 */
import type { PrismaClient, Prisma } from "@prisma/client";
import type { DataExportPort } from "../../application/ports/DataExportPort";
import type { DatabaseSnapshot } from "../../domain/services/Backup";

/** Tables in parent→child (insert) order; delete runs in reverse. */
const TABLES = [
  "permission",
  "role",
  "rolePermission",
  "user",
  "institution",
  "setting",
  "gradeScale",
  "assessmentType",
  "assessmentConfig",
  "transcriptTemplate",
  "faculty",
  "department",
  "programme",
  "level",
  "academicSession",
  "semester",
  "course",
  "student",
  "studentEnrollment",
  "result",
  "transcript",
  "auditLog",
  "backup",
  "notification",
] as const;

interface TableDelegate {
  findMany(): Promise<Record<string, unknown>[]>;
  deleteMany(): Promise<unknown>;
  createMany(args: { data: Record<string, unknown>[] }): Promise<unknown>;
}

function delegate(
  client: PrismaClient | Prisma.TransactionClient,
  table: string,
): TableDelegate {
  return (client as unknown as Record<string, TableDelegate>)[table]!;
}

export class PrismaDataExport implements DataExportPort {
  constructor(private readonly db: PrismaClient) {}

  async exportAll(): Promise<DatabaseSnapshot> {
    const snapshot: DatabaseSnapshot = {};
    for (const table of TABLES) {
      snapshot[table] = await delegate(this.db, table).findMany();
    }
    return snapshot;
  }

  async importAll(snapshot: DatabaseSnapshot): Promise<void> {
    await this.db.$transaction(async (tx) => {
      // Delete children → parents.
      for (let i = TABLES.length - 1; i >= 0; i--) {
        await delegate(tx, TABLES[i]!).deleteMany();
      }
      // Insert parents → children.
      for (const table of TABLES) {
        const rows = snapshot[table];
        if (rows && rows.length > 0) {
          await delegate(tx, table).createMany({ data: rows });
        }
      }
    });
  }
}
