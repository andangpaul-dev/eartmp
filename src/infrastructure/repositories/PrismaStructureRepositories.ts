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
  Programme,
  Level,
  AcademicSession,
  Semester,
} from "../../domain/entities/structure";
import type {
  FacultyRepository,
  DepartmentRepository,
  ProgrammeRepository,
  LevelRepository,
  AcademicSessionRepository,
  SemesterRepository,
} from "../../domain/repositories/structure";

const live = { deletedAt: null } as const;

export class PrismaFacultyRepository implements FacultyRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(data: Omit<Faculty, "id">): Promise<Faculty> {
    const r = await this.db.faculty.create({ data });
    return { id: r.id, name: r.name, code: r.code };
  }
  async update(id: string, patch: Partial<Omit<Faculty, "id">>) {
    const r = await this.db.faculty.update({ where: { id }, data: patch });
    return { id: r.id, name: r.name, code: r.code };
  }
  async softDelete(id: string): Promise<void> {
    await this.db.faculty.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
  async findById(id: string): Promise<Faculty | null> {
    const r = await this.db.faculty.findFirst({ where: { id, ...live } });
    return r ? { id: r.id, name: r.name, code: r.code } : null;
  }
  async findByCode(code: string): Promise<Faculty | null> {
    const r = await this.db.faculty.findFirst({ where: { code, ...live } });
    return r ? { id: r.id, name: r.name, code: r.code } : null;
  }
  async list(): Promise<Faculty[]> {
    const rows = await this.db.faculty.findMany({
      where: live,
      orderBy: { code: "asc" },
    });
    return rows.map((r) => ({ id: r.id, name: r.name, code: r.code }));
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
}

export class PrismaProgrammeRepository implements ProgrammeRepository {
  constructor(private readonly db: PrismaClient) {}
  private map(r: {
    id: string;
    name: string;
    code: string;
    departmentId: string;
    durationLevels: number;
    creditsRequired: number;
  }): Programme {
    return {
      id: r.id,
      name: r.name,
      code: r.code,
      departmentId: r.departmentId,
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
  }): Level {
    return { id: r.id, name: r.name, rank: r.rank, programmeId: r.programmeId };
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
