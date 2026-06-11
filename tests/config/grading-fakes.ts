/**
 * In-memory fakes for the Phase 8 grading-config management tests. Model live
 * rows + single-default semantics so set-default/guarded-delete can be tested.
 */
import type {
  GradeScaleConfigRepository,
  AssessmentConfigRepository,
  StoredGradeScale,
  StoredAssessmentConfig,
} from "../../src/domain/repositories/grading";

export class FakeGradeScaleRepo implements GradeScaleConfigRepository {
  readonly byId = new Map<string, StoredGradeScale>();
  private deleted = new Set<string>();
  private seq = 0;
  private live() {
    return [...this.byId.values()].filter((s) => !this.deleted.has(s.id));
  }
  async findDefault() {
    return this.live().find((s) => s.isDefault) ?? null;
  }
  async findById(id: string) {
    return !this.deleted.has(id) ? (this.byId.get(id) ?? null) : null;
  }
  async findByName(name: string) {
    return this.live().find((s) => s.name === name) ?? null;
  }
  async list() {
    return this.live();
  }
  async create(data: Omit<StoredGradeScale, "id">) {
    const s: StoredGradeScale = { id: `gs${++this.seq}`, ...data };
    this.byId.set(s.id, s);
    return { ...s };
  }
  async update(
    id: string,
    patch: Partial<Pick<StoredGradeScale, "name" | "bands">>,
  ) {
    const cur = this.byId.get(id)!;
    const updated = { ...cur, ...patch };
    this.byId.set(id, updated);
    return { ...updated };
  }
  async softDelete(id: string) {
    this.deleted.add(id);
  }
  async setDefault(id: string) {
    for (const s of this.live()) s.isDefault = s.id === id;
  }
}

export class FakeAssessmentConfigRepo implements AssessmentConfigRepository {
  readonly byId = new Map<string, StoredAssessmentConfig>();
  private deleted = new Set<string>();
  private seq = 0;
  private live() {
    return [...this.byId.values()].filter((s) => !this.deleted.has(s.id));
  }
  async findDefault() {
    return this.live().find((s) => s.isDefault) ?? null;
  }
  async findById(id: string) {
    return !this.deleted.has(id) ? (this.byId.get(id) ?? null) : null;
  }
  async findByName(name: string) {
    return this.live().find((s) => s.name === name) ?? null;
  }
  async list() {
    return this.live();
  }
  async create(data: Omit<StoredAssessmentConfig, "id">) {
    const s: StoredAssessmentConfig = { id: `ac${++this.seq}`, ...data };
    this.byId.set(s.id, s);
    return { ...s };
  }
  async update(
    id: string,
    patch: Partial<Pick<StoredAssessmentConfig, "name" | "components">>,
  ) {
    const cur = this.byId.get(id)!;
    const updated = { ...cur, ...patch };
    this.byId.set(id, updated);
    return { ...updated };
  }
  async softDelete(id: string) {
    this.deleted.add(id);
  }
  async setDefault(id: string) {
    for (const s of this.live()) s.isDefault = s.id === id;
  }
}
