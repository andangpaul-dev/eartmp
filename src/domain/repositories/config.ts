/**
 * Config repository ports — institution profile and the settings key/value
 * store. The settings store deals in the raw JSON envelope string; the typed
 * validation is the SettingsRegistry's job in the application layer.
 */
import type { Institution } from "../entities/institution";

export interface InstitutionRepository {
  /** The singleton institution, or null if not provisioned. */
  get(): Promise<Institution | null>;
  update(patch: Partial<Institution>): Promise<Institution>;
}

export interface SettingRepository {
  /** Raw stored envelope JSON for a key, or null if unset. */
  getRaw(key: string): Promise<string | null>;
  setRaw(key: string, raw: string): Promise<void>;
  /** All stored settings as raw key/value pairs. */
  all(): Promise<{ key: string; value: string }[]>;
}
