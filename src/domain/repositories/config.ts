/**
 * Config repository ports — institution profile and the settings key/value
 * store. The settings store deals in the raw JSON envelope string; the typed
 * validation is the SettingsRegistry's job in the application layer.
 */
import type { Institution } from "../entities/institution";

export interface InstitutionRepository {
  /** The default/operative institution (used by transcripts), or null. */
  get(): Promise<Institution | null>;
  update(patch: Partial<Institution>): Promise<Institution>;
  // --- multi-institution management (Feature: institutions own faculties) ---
  list(): Promise<Institution[]>;
  findById(id: string): Promise<Institution | null>;
  create(data: Partial<Institution> & { name: string }): Promise<Institution>;
  updateById(id: string, patch: Partial<Institution>): Promise<Institution>;
  softDelete(id: string): Promise<void>;
  /** Make this the only default institution. */
  setDefault(id: string): Promise<void>;
  countLiveFaculties(institutionId: string): Promise<number>;
}

export interface SettingRepository {
  /** Raw stored envelope JSON for a key, or null if unset. */
  getRaw(key: string): Promise<string | null>;
  setRaw(key: string, raw: string): Promise<void>;
  /** All stored settings as raw key/value pairs. */
  all(): Promise<{ key: string; value: string }[]>;
}
