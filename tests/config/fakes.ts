/**
 * In-memory fakes for the config (institution + settings) tests.
 */
import type { Institution } from "../../src/domain/entities/institution";
import type {
  InstitutionRepository,
  SettingRepository,
} from "../../src/domain/repositories/config";

export class InMemoryInstitutionRepository implements InstitutionRepository {
  readonly rows: Institution[] = [];
  private seq = 0;
  faculties = 0; // test knob for countLiveFaculties
  constructor(institution: Institution | null) {
    if (institution) this.rows.push({ ...institution, isDefault: true });
  }
  async get(): Promise<Institution | null> {
    const def = this.rows.find((r) => r.isDefault) ?? this.rows[0];
    return def ? { ...def } : null;
  }
  async update(patch: Partial<Institution>): Promise<Institution> {
    const def = this.rows.find((r) => r.isDefault) ?? this.rows[0];
    if (!def) throw new Error("not provisioned");
    Object.assign(def, patch);
    return { ...def };
  }
  async list(): Promise<Institution[]> {
    return this.rows.map((r) => ({ ...r }));
  }
  async findById(id: string): Promise<Institution | null> {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  async create(
    data: Partial<Institution> & { name: string },
  ): Promise<Institution> {
    const inst: Institution = {
      id: `inst-${++this.seq}`,
      calendarType: "SEMESTER",
      ...data,
      isDefault: data.isDefault ?? this.rows.length === 0,
    };
    this.rows.push(inst);
    return { ...inst };
  }
  async updateById(
    id: string,
    patch: Partial<Institution>,
  ): Promise<Institution> {
    const r = this.rows.find((x) => x.id === id)!;
    Object.assign(r, patch);
    return { ...r };
  }
  async softDelete(id: string): Promise<void> {
    const i = this.rows.findIndex((x) => x.id === id);
    if (i >= 0) this.rows.splice(i, 1);
  }
  async setDefault(id: string): Promise<void> {
    for (const r of this.rows) r.isDefault = r.id === id;
  }
  async countLiveFaculties(): Promise<number> {
    return this.faculties;
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
