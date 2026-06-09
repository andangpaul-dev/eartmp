/**
 * In-memory fakes for the config (institution + settings) tests.
 */
import type { Institution } from "../../src/domain/entities/institution";
import type {
  InstitutionRepository,
  SettingRepository,
} from "../../src/domain/repositories/config";

export class InMemoryInstitutionRepository implements InstitutionRepository {
  constructor(private institution: Institution | null) {}
  async get(): Promise<Institution | null> {
    return this.institution ? { ...this.institution } : null;
  }
  async update(patch: Partial<Institution>): Promise<Institution> {
    if (!this.institution) throw new Error("not provisioned");
    this.institution = { ...this.institution, ...patch };
    return { ...this.institution };
  }
}

export class InMemorySettingRepository implements SettingRepository {
  readonly store = new Map<string, string>();
  constructor(seed: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(seed)) this.store.set(k, v);
  }
  async getRaw(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async setRaw(key: string, raw: string): Promise<void> {
    this.store.set(key, raw);
  }
  async all(): Promise<{ key: string; value: string }[]> {
    return [...this.store.entries()].map(([key, value]) => ({ key, value }));
  }
}

export const sampleInstitution: Institution = {
  id: "inst-1",
  name: "Example University",
  calendarType: "SEMESTER",
};
