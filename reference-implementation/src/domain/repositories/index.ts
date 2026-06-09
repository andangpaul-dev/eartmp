/**
 * Repository interfaces (ports). The domain/application layers depend on these
 * abstractions; infrastructure provides Prisma-backed implementations. This is
 * the dependency-inversion boundary required by Clean Architecture.
 */

import type { Student, Course, ResultRecord, Transcript } from "../entities";

export interface Repository<T> {
  findById(id: string): Promise<T | null>;
  findAll(): Promise<T[]>;
  create(entity: Omit<T, "id">): Promise<T>;
  update(id: string, patch: Partial<T>): Promise<T>;
  softDelete(id: string): Promise<void>;
}

export interface StudentRepository extends Repository<Student> {
  findByMatric(matricNumber: string): Promise<Student | null>;
  findByDepartment(departmentId: string): Promise<Student[]>;
}

export interface CourseRepository extends Repository<Course> {
  findByCode(code: string): Promise<Course | null>;
  findByProgramme(programmeId: string): Promise<Course[]>;
}

export interface ResultRepository extends Repository<ResultRecord> {
  findByStudentAndSemester(
    studentId: string,
    semesterId: string,
  ): Promise<ResultRecord[]>;
  findByStudent(studentId: string): Promise<ResultRecord[]>;
  existsFor(
    studentId: string,
    courseId: string,
    semesterId: string,
  ): Promise<boolean>;
}

export interface TranscriptRepository extends Repository<Transcript> {
  findByStudent(studentId: string): Promise<Transcript[]>;
  nextTranscriptNumber(rule?: string): Promise<string>;
}

/** Audit logging is append-only — deliberately not a CRUD Repository. */
export interface AuditLogPort {
  record(entry: {
    userId?: string;
    action: string;
    entity: string;
    recordId?: string;
    oldValue?: unknown;
    newValue?: unknown;
  }): Promise<void>;
}
