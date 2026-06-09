/**
 * Academic-structure repository ports. All reads/writes operate on LIVE rows
 * (deletedAt IS NULL) by default; `findByCode`/`findByName` enforce the
 * partial-unique-among-live contract (ADR-010 / F-20). `softDelete` tombstones.
 */
import type {
  Faculty,
  Department,
  Programme,
  Level,
  AcademicSession,
  Semester,
} from "../entities/structure";

export interface FacultyRepository {
  create(data: Omit<Faculty, "id">): Promise<Faculty>;
  update(id: string, patch: Partial<Omit<Faculty, "id">>): Promise<Faculty>;
  softDelete(id: string): Promise<void>;
  findById(id: string): Promise<Faculty | null>;
  findByCode(code: string): Promise<Faculty | null>;
  list(): Promise<Faculty[]>;
  hasLiveDepartments(facultyId: string): Promise<boolean>;
}

export interface DepartmentRepository {
  create(data: Omit<Department, "id">): Promise<Department>;
  update(
    id: string,
    patch: Partial<Omit<Department, "id">>,
  ): Promise<Department>;
  softDelete(id: string): Promise<void>;
  findById(id: string): Promise<Department | null>;
  findByCode(code: string): Promise<Department | null>;
  listByFaculty(facultyId: string): Promise<Department[]>;
  hasLiveProgrammes(departmentId: string): Promise<boolean>;
}

export interface ProgrammeRepository {
  create(data: Omit<Programme, "id">): Promise<Programme>;
  update(id: string, patch: Partial<Omit<Programme, "id">>): Promise<Programme>;
  softDelete(id: string): Promise<void>;
  findById(id: string): Promise<Programme | null>;
  findByCode(code: string): Promise<Programme | null>;
  listByDepartment(departmentId: string): Promise<Programme[]>;
  hasLiveLevels(programmeId: string): Promise<boolean>;
}

export interface LevelRepository {
  create(data: Omit<Level, "id">): Promise<Level>;
  update(id: string, patch: Partial<Omit<Level, "id">>): Promise<Level>;
  softDelete(id: string): Promise<void>;
  findById(id: string): Promise<Level | null>;
  listByProgramme(programmeId: string): Promise<Level[]>;
  existsRank(programmeId: string, rank: number): Promise<boolean>;
}

export interface AcademicSessionRepository {
  create(data: Omit<AcademicSession, "id">): Promise<AcademicSession>;
  update(
    id: string,
    patch: Partial<Omit<AcademicSession, "id">>,
  ): Promise<AcademicSession>;
  softDelete(id: string): Promise<void>;
  findById(id: string): Promise<AcademicSession | null>;
  findByName(name: string): Promise<AcademicSession | null>;
  findCurrent(): Promise<AcademicSession | null>;
  list(): Promise<AcademicSession[]>;
  /** Clear `isCurrent` on all live sessions except the given id. */
  clearCurrentExcept(id: string): Promise<void>;
}

export interface SemesterRepository {
  create(data: Omit<Semester, "id">): Promise<Semester>;
  softDelete(id: string): Promise<void>;
  findById(id: string): Promise<Semester | null>;
  listBySession(sessionId: string): Promise<Semester[]>;
  existsRank(sessionId: string, rank: number): Promise<boolean>;
}
