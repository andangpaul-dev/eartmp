/**
 * In-memory fakes for the Phase 6 records tests (students, courses, enrollment).
 * Model live vs soft-deleted rows and paginated find.
 */
import type { Student, Course } from "../../src/domain/entities";
import type { StudentEnrollment } from "../../src/domain/entities/enrollment";
import { UniqueConstraintError } from "../../src/domain/errors/persistence";
import type {
  StudentRepository,
  CourseRepository,
  StudentEnrollmentRepository,
  StudentQuery,
  CourseQuery,
  Page,
} from "../../src/domain/repositories/records";

export class FakeStudentRepo implements StudentRepository {
  private byId = new Map<string, Student>();
  private deleted = new Set<string>();
  private seq = 0;
  private live(): Student[] {
    return [...this.byId.values()].filter((s) => !this.deleted.has(s.id));
  }
  async create(data: Omit<Student, "id">): Promise<Student> {
    const s: Student = { id: `st${++this.seq}`, ...data };
    this.byId.set(s.id, s);
    return { ...s };
  }
  async update(id: string, patch: Partial<Omit<Student, "id">>) {
    const cur = this.byId.get(id);
    if (!cur) throw new Error("no student");
    const updated = { ...cur, ...patch };
    this.byId.set(id, updated);
    return { ...updated };
  }
  async softDelete(id: string) {
    this.deleted.add(id);
  }
  async findById(id: string) {
    return !this.deleted.has(id) && this.byId.has(id)
      ? { ...(this.byId.get(id) as Student) }
      : null;
  }
  async findByMatric(matricNumber: string) {
    return this.live().find((s) => s.matricNumber === matricNumber) ?? null;
  }
  async find(query: StudentQuery): Promise<Page<Student>> {
    const f = query.where ?? {};
    let items = this.live().filter(
      (s) =>
        (!f.status || s.status === f.status) &&
        (!f.departmentId || s.departmentId === f.departmentId) &&
        (!f.programmeId || s.programmeId === f.programmeId) &&
        (!f.levelId || s.levelId === f.levelId) &&
        (!f.search ||
          s.matricNumber.includes(f.search) ||
          s.fullName.includes(f.search)),
    );
    items = items.sort((a, b) => a.matricNumber.localeCompare(b.matricNumber));
    const total = items.length;
    const skip = query.skip ?? 0;
    const take = query.take ?? 50;
    return { items: items.slice(skip, skip + take), total };
  }
}

export class FakeCourseRepo implements CourseRepository {
  private byId = new Map<string, Course>();
  private deleted = new Set<string>();
  private seq = 0;
  private live(): Course[] {
    return [...this.byId.values()].filter((c) => !this.deleted.has(c.id));
  }
  async create(data: Omit<Course, "id">): Promise<Course> {
    // Mimic the per-institution (institutionId, code) unique index.
    const dup = this.live().find(
      (c) =>
        c.code === data.code &&
        (c.institutionId ?? null) === (data.institutionId ?? null),
    );
    if (dup) throw new UniqueConstraintError("code");
    const c: Course = { id: `co${++this.seq}`, ...data };
    this.byId.set(c.id, c);
    return { ...c };
  }
  async update(id: string, patch: Partial<Omit<Course, "id">>) {
    const cur = this.byId.get(id);
    if (!cur) throw new Error("no course");
    const updated = { ...cur, ...patch };
    this.byId.set(id, updated);
    return { ...updated };
  }
  async softDelete(id: string) {
    this.deleted.add(id);
  }
  async findById(id: string) {
    return !this.deleted.has(id) && this.byId.has(id)
      ? { ...(this.byId.get(id) as Course) }
      : null;
  }
  async findByCode(code: string) {
    return this.live().find((c) => c.code === code) ?? null;
  }
  async find(query: CourseQuery): Promise<Page<Course>> {
    const f = query.where ?? {};
    const items = this.live().filter(
      (c) =>
        (!f.courseType || c.courseType === f.courseType) &&
        (!f.programmeId || c.programmeId === f.programmeId) &&
        (!f.search || c.code.includes(f.search) || c.title.includes(f.search)),
    );
    const total = items.length;
    const skip = query.skip ?? 0;
    const take = query.take ?? 50;
    return { items: items.slice(skip, skip + take), total };
  }
}

export class FakeEnrollmentRepo implements StudentEnrollmentRepository {
  readonly rows: StudentEnrollment[] = [];
  private seq = 0;
  async create(
    data: Omit<StudentEnrollment, "id">,
  ): Promise<StudentEnrollment> {
    const e: StudentEnrollment = { id: `en${++this.seq}`, ...data };
    this.rows.push(e);
    return { ...e };
  }
  async findCurrent(studentId: string) {
    return (
      this.rows.find((e) => e.studentId === studentId && e.isCurrent) ?? null
    );
  }
  async closeCurrent(studentId: string, toSession: string) {
    for (const e of this.rows) {
      if (e.studentId === studentId && e.isCurrent) {
        e.isCurrent = false;
        e.toSession = toSession;
      }
    }
  }
  async listByStudent(studentId: string) {
    return this.rows
      .filter((e) => e.studentId === studentId)
      .map((e) => ({ ...e }));
  }
}
