/**
 * DataExportPort — export/import the full dataset (Phase 17). Keeps the backup
 * use-cases free of Prisma; the dev impl dumps/loads all tables, while the shell
 * impl can swap to a Tauri-SQL file copy without touching the use-cases.
 * `importAll` MUST be atomic (all-or-nothing).
 */
import type { DatabaseSnapshot } from "../../domain/services/Backup";

export interface DataExportPort {
  exportAll(): Promise<DatabaseSnapshot>;
  /** Replace all data with the snapshot, atomically. */
  importAll(snapshot: DatabaseSnapshot): Promise<void>;
}
