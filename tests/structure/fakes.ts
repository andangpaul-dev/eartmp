/**
 * In-memory fakes for the academic-structure tests. They model live vs
 * soft-deleted rows so partial-unique reuse and soft-delete guards can be
 * exercised with no DB.
 */
import type {
  Faculty,
  Department,
  SubDepartment,
  Programme,
  Level,
  AcademicSession,
  Semester,
} from "../../src/domain/entities/structure";
import type {
  FacultyRepository,
  DepartmentRepository,
  SubDepartmentRepository,
  ProgrammeRepository,
  LevelRepository,
  AcademicSessionRepository,
  SemesterRepository,
} from "../../src/domain/repositories/structure";

class Store<T extends { id: string }> {
  readonly byId = new Map<string, T>();
  readonly deleted = new Set<string>();
  private seq = 0;
  add(data: Omit<T, "id">, prefix: string): T {
    const entity = { id: `${prefix}${++this.seq}`, ...data } as T;
    this.byId.set(entity.id, entity);
    return { ...entity };
  }
  live(): T[] {
    return [...this.byId.values()].filter((e) => !this.deleted.has(e.id));
  }
  get(id: string): T | null {
    return !this.deleted.has(id) && this.byId.has(id)
      ? { ...(this.byId.get(id) as T) }
      : null;
  }
  patch(id: string, p: Partial<T>): T {
    const updated = { ...(this.byId.get(id) as T), ...p };
    this.byId.set(id, updated);
    return { ...updated };
  }
  remove(id: string): void {
    this.deleted.add(id);
  }
}

export class FakeFacultyRepo implements FacultyRepository {
  readonly s = new Store<Faculty>();
  departments?: FakeDepartmentRepo;
  async create(d: Omit<Faculty, "id">) {
    return this.s.add(d, "f");
  }
  async update(id: string, p: Partial<Omit<Faculty, "id">>) {
    return this.s.patch(id, p);
  }
  async softDelete(id: string) {
    this.s.remove(id);
  }
  async findById(id: string) {
    return this.s.get(id);
  }
  async findByCode(code: string) {
    return this.s.live().find((f) => f.code === code) ?? null;
  }
  async list() {
    return this.s.live();
  }
  async hasLiveDepartments(facultyId: string) {
    return (this.departments?.s.live() ?? []).some(
      (d) => d.facultyId === facultyId,
    );
  }
}

export class FakeDepartmentRepo implements DepartmentRepository {
  readonly s = new Store<Department>();
  programmes?: FakeProgrammeRepo;
  async create(d: Omit<Department, "id">) {
    return this.s.add(d, "d");
  }
  async update(id: string, p: Partial<Omit<Department, "id">>) {
    return this.s.patch(id, p);
  }
  async softDelete(id: string) {
    this.s.remove(id);
  }
  async findById(id: string) {
    return this.s.get(id);
  }
  async findByCode(code: string) {
    return this.s.live().find((d) => d.code === code) ?? null;
  }
  async listByFaculty(facultyId: string) {
    return this.s.live().filter((d) => d.facultyId === facultyId);
  }
  async hasLiveProgrammes(departmentId: string) {
    return (this.programmes?.s.live() ?? []).some(
      (p) => p.departmentId === departmentId,
    );
  }
  subDepartments?: FakeSubDepartmentRepo;
  async hasLiveSubDepartments(departmentId: string) {
    return (this.subDepartments?.s.live() ?? []).some(
      (sd) => sd.departmentId === departmentId,
    );
  }
}

export class FakeSubDepartmentRepo implements SubDepartmentRepository {
  readonly s = new Store<SubDepartment>();
  programmes?: FakeProgrammeRepo;
  async create(d: Omit<SubDepartment, "id">) {
    return this.s.add(d, "sd");
  }
  async update(id: string, p: Partial<Omit<SubDepartment, "id">>) {
    return this.s.patch(id, p);
  }
  async softDelete(id: string) {
    this.s.remove(id);
  }
  async findById(id: string) {
    return this.s.get(id);
  }
  async findByCode(code: string) {
    return this.s.live().find((sd) => sd.code === code) ?? null;
  }
  async listByDepartment(departmentId: string) {
    return this.s.live().filter((sd) => sd.departmentId === departmentId);
  }
  async hasLiveChildren(subDepartmentId: string) {
    return (this.programmes?.s.live() ?? []).some(
      (p) => p.subDepartmentId === subDepartmentId,
    );
  }
}

export class FakeProgrammeRepo implements ProgrammeRepository {
  readonly s = new Store<Programme>();
  levels?: FakeLevelRepo;
  async create(d: Omit<Programme, "id">) {
    return this.s.add(d, "p");
  }
  async update(id: string, p: Partial<Omit<Programme, "id">>) {
    return this.s.patch(id, p);
  }
  async softDelete(id: string) {
    this.s.remove(id);
  }
  async findById(id: string) {
    return this.s.get(id);
  }
  async findByCode(code: string) {
    return this.s.live().find((p) => p.code === code) ?? null;
  }
  async listByDepartment(departmentId: string) {
    return this.s.live().filter((p) => p.departmentId === departmentId);
  }
  async hasLiveLevels(programmeId: string) {
    return (this.levels?.s.live() ?? []).some(
      (l) => l.programmeId === programmeId,
    );
  }
}

export class FakeLevelRepo implements LevelRepository {
  readonly s = new Store<Level>();
  async create(d: Omit<Level, "id">) {
    return this.s.add(d, "l");
  }
  async update(id: string, p: Partial<Omit<Level, "id">>) {
    return this.s.patch(id, p);
  }
  async softDelete(id: string) {
    this.s.remove(id);
  }
  async findById(id: string) {
    return this.s.get(id);
  }
  async listByProgramme(programmeId: string) {
    return this.s
      .live()
      .filter((l) => l.programmeId === programmeId)
      .sort((a, b) => a.rank - b.rank);
  }
  async existsRank(programmeId: string, rank: number) {
    return this.s
      .live()
      .some((l) => l.programmeId === programmeId && l.rank === rank);
  }
}

export class FakeSessionRepo implements AcademicSessionRepository {
  readonly s = new Store<AcademicSession>();
  async create(d: Omit<AcademicSession, "id">) {
    return this.s.add(d, "s");
  }
  async update(id: string, p: Partial<Omit<AcademicSession, "id">>) {
    return this.s.patch(id, p);
  }
  async softDelete(id: string) {
    this.s.remove(id);
  }
  async findById(id: string) {
    return this.s.get(id);
  }
  async findByName(name: string) {
    return this.s.live().find((x) => x.name === name) ?? null;
  }
  async findCurrent() {
    return this.s.live().find((x) => x.isCurrent) ?? null;
  }
  async list() {
    return this.s.live();
  }
  async clearCurrentExcept(id: string) {
    for (const x of this.s.live()) {
      if (x.id !== id && x.isCurrent) this.s.patch(x.id, { isCurrent: false });
    }
  }
}

export class FakeSemesterRepo implements SemesterRepository {
  readonly s = new Store<Semester>();
  async create(d: Omit<Semester, "id">) {
    return this.s.add(d, "sem");
  }
  async softDelete(id: string) {
    this.s.remove(id);
  }
  async findById(id: string) {
    return this.s.get(id);
  }
  async listBySession(sessionId: string) {
    return this.s
      .live()
      .filter((x) => x.sessionId === sessionId)
      .sort((a, b) => a.rank - b.rank);
  }
  async existsRank(sessionId: string, rank: number) {
    return this.s
      .live()
      .some((x) => x.sessionId === sessionId && x.rank === rank);
  }
}
