/**
 * Prisma-backed academic-structure repositories — DEV-ONLY adapter (ADR-007;
 * replaced by the Tauri-SQL data layer in Phase 7). All reads filter
 * `deletedAt: null` (live rows); `findByCode`/`findByName` honour the
 * partial-unique-among-live contract; `softDelete` tombstones.
 */
import type { PrismaClient } from "@prisma/client";
import type {
  Faculty,
  Department,
  SubDepartment,
  Programme,
  Level,
  AcademicSession,
  Semester,
} from "../../domain/entities/structure";
import type {
  FacultyRepository,
  DepartmentRepository,
  SubDepartmentRepository,
  ProgrammeRepository,
  LevelRepository,
  AcademicSessionRepository,
  SemesterRepository,
} from "../../domain/repositories/structure";

const live = { deletedAt: null } as const;

function toFaculty(r: {
  id: string;
  name: string;
  code: string;
  institutionId: string | null;
}): Faculty {
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    ...(r.institutionId ? { institutionId: r.institutionId } : {}),
  };
}

export class PrismaFacultyRepository implements FacultyRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(data: Omit<Faculty, "id">): Promise<Faculty> {
    const r = await this.db.faculty.create({
      data: {
        name: data.name,
        code: data.code,
        institutionId: data.institutionId ?? null,
      },
    });
    return toFaculty(r);
  }
  async update(id: string, patch: Partial<Omit<Faculty, "id">>) {
    const r = await this.db.faculty.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.code !== undefined ? { code: patch.code } : {}),
        ...(patch.institutionId !== undefined
          ? { institutionId: patch.institutionId }
          : {}),
      },
    });
    return toFaculty(r);
  }
  async softDelete(id: string): Promise<void> {
    await this.db.faculty.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
  async findById(id: string): Promise<Faculty | null> {
    const r = await this.db.faculty.findFirst({ where: { id, ...live } });
    return r ? toFaculty(r) : null;
  }
  async findByCode(code: string): Promise<Faculty | null> {
    const r = await this.db.faculty.findFirst({ where: { code, ...live } });
    return r ? toFaculty(r) : null;
  }
  async list(): Promise<Faculty[]> {
    const rows = await this.db.faculty.findMany({
      where: live,
      orderBy: { code: "asc" },
    });
    return rows.map(toFaculty);
  }
  async hasLiveDepartments(facultyId: string): Promise<boolean> {
    return (
      (await this.db.department.count({ where: { facultyId, ...live } })) > 0
    );
  }
}

export class PrismaDepartmentRepository implements DepartmentRepository {
  constructor(private readonly db: PrismaClient) {}
  private map(r: {
    id: string;
    name: string;
    code: string;
    facultyId: string;
  }): Department {
    return { id: r.id, name: r.name, code: r.code, facultyId: r.facultyId };
  }
  async create(data: Omit<Department, "id">) {
    return this.map(await this.db.department.create({ data }));
  }
  async update(id: string, patch: Partial<Omit<Department, "id">>) {
    return this.map(
      await this.db.department.update({ where: { id }, data: patch }),
    );
  }
  async softDelete(id: string): Promise<void> {
    await this.db.department.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
  async findById(id: string) {
    const r = await this.db.department.findFirst({ where: { id, ...live } });
    return r ? this.map(r) : null;
  }
  async findByCode(code: string) {
    const r = await this.db.department.findFirst({ where: { code, ...live } });
    return r ? this.map(r) : null;
  }
  async listByFaculty(facultyId: string) {
    const rows = await this.db.department.findMany({
      where: { facultyId, ...live },
      orderBy: { code: "asc" },
    });
    return rows.map((r) => this.map(r));
  }
  async hasLiveProgrammes(departmentId: string): Promise<boolean> {
    return (
      (await this.db.programme.count({ where: { departmentId, ...live } })) > 0
    );
  }
  async hasLiveSubDepartments(departmentId: string): Promise<boolean> {
    return (
      (await this.db.subDepartment.count({
        where: { departmentId, ...live },
      })) > 0
    );
  }
}

export class PrismaSubDepartmentRepository implements SubDepartmentRepository {
  constructor(private readonly db: PrismaClient) {}
  private map(r: {
    id: string;
    name: string;
    code: string;
    departmentId: string;
  }): SubDepartment {
    return {
      id: r.id,
      name: r.name,
      code: r.code,
      departmentId: r.departmentId,
    };
  }
  async create(data: Omit<SubDepartment, "id">) {
    return this.map(await this.db.subDepartment.create({ data }));
  }
  async update(id: string, patch: Partial<Omit<SubDepartment, "id">>) {
    return this.map(
      await this.db.subDepartment.update({ where: { id }, data: patch }),
    );
  }
  async softDelete(id: string): Promise<void> {
    await this.db.subDepartment.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
  async findById(id: string) {
    const r = await this.db.subDepartment.findFirst({ where: { id, ...live } });
    return r ? this.map(r) : null;
  }
  async findByCode(code: string) {
    const r = await this.db.subDepartment.findFirst({
      where: { code, ...live },
    });
    return r ? this.map(r) : null;
  }
  async listByDepartment(departmentId: string) {
    const rows = await this.db.subDepartment.findMany({
      where: { departmentId, ...live },
      orderBy: { code: "asc" },
    });
    return rows.map((r) => this.map(r));
  }
  async hasLiveChildren(subDepartmentId: string): Promise<boolean> {
    const [programmes, courses, students] = await Promise.all([
      this.db.programme.count({ where: { subDepartmentId, ...live } }),
      this.db.course.count({ where: { subDepartmentId, ...live } }),
      this.db.student.count({ where: { subDepartmentId, ...live } }),
    ]);
    return programmes + courses + students > 0;
  }
}

export class PrismaProgrammeRepository implements ProgrammeRepository {
  constructor(private readonly db: PrismaClient) {}
  private map(r: {
    id: string;
    name: string;
    code: string;
    departmentId: string;
    subDepartmentId: string | null;
    durationLevels: number;
    creditsRequired: number;
  }): Programme {
    return {
      id: r.id,
      name: r.name,
      code: r.code,
      departmentId: r.departmentId,
      ...(r.subDepartmentId ? { subDepartmentId: r.subDepartmentId } : {}),
      durationLevels: r.durationLevels,
      creditsRequired: r.creditsRequired,
    };
  }
  async create(data: Omit<Programme, "id">) {
    return this.map(await this.db.programme.create({ data }));
  }
  async update(id: string, patch: Partial<Omit<Programme, "id">>) {
    return this.map(
      await this.db.programme.update({ where: { id }, data: patch }),
    );
  }
  async softDelete(id: string): Promise<void> {
    await this.db.programme.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
  async findById(id: string) {
    const r = await this.db.programme.findFirst({ where: { id, ...live } });
    return r ? this.map(r) : null;
  }
  async findByCode(code: string) {
    const r = await this.db.programme.findFirst({ where: { code, ...live } });
    return r ? this.map(r) : null;
  }
  async listByDepartment(departmentId: string) {
    const rows = await this.db.programme.findMany({
      where: { departmentId, ...live },
      orderBy: { code: "asc" },
    });
    return rows.map((r) => this.map(r));
  }
  async hasLiveLevels(programmeId: string): Promise<boolean> {
    return (await this.db.level.count({ where: { programmeId, ...live } })) > 0;
  }
}

export class PrismaLevelRepository implements LevelRepository {
  constructor(private readonly db: PrismaClient) {}
  private map(r: {
    id: string;
    name: string;
    rank: number;
    programmeId: string;
    gradeScaleId: string | null;
  }): Level {
    return {
      id: r.id,
      name: r.name,
      rank: r.rank,
      programmeId: r.programmeId,
      ...(r.gradeScaleId ? { gradeScaleId: r.gradeScaleId } : {}),
    };
  }
  async create(data: Omit<Level, "id">) {
    return this.map(await this.db.level.create({ data }));
  }
  async update(id: string, patch: Partial<Omit<Level, "id">>) {
    return this.map(await this.db.level.update({ where: { id }, data: patch }));
  }
  async softDelete(id: string): Promise<void> {
    await this.db.level.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
  async findById(id: string) {
    const r = await this.db.level.findFirst({ where: { id, ...live } });
    return r ? this.map(r) : null;
  }
  async listByProgramme(programmeId: string) {
    const rows = await this.db.level.findMany({
      where: { programmeId, ...live },
      orderBy: { rank: "asc" },
    });
    return rows.map((r) => this.map(r));
  }
  async existsRank(programmeId: string, rank: number): Promise<boolean> {
    return (
      (await this.db.level.count({ where: { programmeId, rank, ...live } })) > 0
    );
  }
}

export class PrismaAcademicSessionRepository implements AcademicSessionRepository {
  constructor(private readonly db: PrismaClient) {}
  private map(r: {
    id: string;
    name: string;
    startDate: Date | null;
    endDate: Date | null;
    isCurrent: boolean;
  }): AcademicSession {
    return {
      id: r.id,
      name: r.name,
      startDate: r.startDate ?? undefined,
      endDate: r.endDate ?? undefined,
      isCurrent: r.isCurrent,
    };
  }
  async create(data: Omit<AcademicSession, "id">) {
    return this.map(
      await this.db.academicSession.create({
        data: {
          name: data.name,
          isCurrent: data.isCurrent,
          ...(data.startDate !== undefined
            ? { startDate: data.startDate }
            : {}),
          ...(data.endDate !== undefined ? { endDate: data.endDate } : {}),
        },
      }),
    );
  }
  async update(id: string, patch: Partial<Omit<AcademicSession, "id">>) {
    return this.map(
      await this.db.academicSession.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.isCurrent !== undefined
            ? { isCurrent: patch.isCurrent }
            : {}),
          ...(patch.startDate !== undefined
            ? { startDate: patch.startDate }
            : {}),
          ...(patch.endDate !== undefined ? { endDate: patch.endDate } : {}),
        },
      }),
    );
  }
  async softDelete(id: string): Promise<void> {
    await this.db.academicSession.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
  async findById(id: string) {
    const r = await this.db.academicSession.findFirst({
      where: { id, ...live },
    });
    return r ? this.map(r) : null;
  }
  async findByName(name: string) {
    const r = await this.db.academicSession.findFirst({
      where: { name, ...live },
    });
    return r ? this.map(r) : null;
  }
  async findCurrent() {
    const r = await this.db.academicSession.findFirst({
      where: { isCurrent: true, ...live },
    });
    return r ? this.map(r) : null;
  }
  async list() {
    const rows = await this.db.academicSession.findMany({
      where: live,
      orderBy: { name: "asc" },
    });
    return rows.map((r) => this.map(r));
  }
  async clearCurrentExcept(id: string): Promise<void> {
    await this.db.academicSession.updateMany({
      where: { id: { not: id }, ...live },
      data: { isCurrent: false },
    });
  }
}

export class PrismaSemesterRepository implements SemesterRepository {
  constructor(private readonly db: PrismaClient) {}
  private map(r: {
    id: string;
    name: string;
    rank: number;
    sessionId: string;
  }): Semester {
    return { id: r.id, name: r.name, rank: r.rank, sessionId: r.sessionId };
  }
  async create(data: Omit<Semester, "id">) {
    return this.map(await this.db.semester.create({ data }));
  }
  async softDelete(id: string): Promise<void> {
    await this.db.semester.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
  async findById(id: string) {
    const r = await this.db.semester.findFirst({ where: { id, ...live } });
    return r ? this.map(r) : null;
  }
  async listBySession(sessionId: string) {
    const rows = await this.db.semester.findMany({
      where: { sessionId, ...live },
      orderBy: { rank: "asc" },
    });
    return rows.map((r) => this.map(r));
  }
  async existsRank(sessionId: string, rank: number): Promise<boolean> {
    return (
      (await this.db.semester.count({ where: { sessionId, rank, ...live } })) >
      0
    );
  }
}
