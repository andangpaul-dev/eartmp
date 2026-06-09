/**
 * Records repository ports — students, courses, enrollment, results.
 *
 * These are the **canonical** ports (paginated, F-7-aware). Phase 7 reconciled
 * them: the reference `ProcessSemesterResults` now depends on the canonical
 * `CourseRepository`/`ResultRepository` here, and the legacy generic ports were
 * retired from `./index.ts`. `findByMatric`/`findByCode` resolve LIVE rows only
 * (partial-unique contract, Phase 5).
 */
import type { Student, Course, StudentStatus, ResultRecord } from "../entities";
import type { StudentEnrollment } from "../entities/enrollment";

/** A page of results plus the total count of matching live rows. */
export interface Page<T> {
  items: T[];
  total: number;
}

export interface StudentFilter {
  departmentId?: string;
  programmeId?: string;
  levelId?: string;
  status?: StudentStatus;
  search?: string; // matric or name contains
}

export interface StudentQuery {
  where?: StudentFilter;
  skip?: number;
  take?: number;
}

export interface StudentRepository {
  create(data: Omit<Student, "id">): Promise<Student>;
  update(id: string, patch: Partial<Omit<Student, "id">>): Promise<Student>;
  softDelete(id: string): Promise<void>;
  findById(id: string): Promise<Student | null>;
  findByMatric(matricNumber: string): Promise<Student | null>;
  find(query: StudentQuery): Promise<Page<Student>>;
}

export interface CourseFilter {
  departmentId?: string;
  programmeId?: string;
  levelId?: string;
  courseType?: string;
  search?: string; // code or title contains
}

export interface CourseQuery {
  where?: CourseFilter;
  skip?: number;
  take?: number;
}

export interface CourseRepository {
  create(data: Omit<Course, "id">): Promise<Course>;
  update(id: string, patch: Partial<Omit<Course, "id">>): Promise<Course>;
  softDelete(id: string): Promise<void>;
  findById(id: string): Promise<Course | null>;
  findByCode(code: string): Promise<Course | null>;
  find(query: CourseQuery): Promise<Page<Course>>;
}

export interface StudentEnrollmentRepository {
  create(data: Omit<StudentEnrollment, "id">): Promise<StudentEnrollment>;
  findCurrent(studentId: string): Promise<StudentEnrollment | null>;
  /** Close the student's current enrollment (set toSession + isCurrent=false). */
  closeCurrent(studentId: string, toSession: string): Promise<void>;
  listByStudent(studentId: string): Promise<StudentEnrollment[]>;
}

/** Canonical result port (used by ProcessSemesterResults; full CRUD in Phase 9). */
export interface ResultRepository {
  findByStudentAndSemester(
    studentId: string,
    semesterId: string,
  ): Promise<ResultRecord[]>;
  /** Persist the processed grade/points for a result (records provenance). */
  updateProcessed(
    id: string,
    data: {
      grade: string;
      gradePoint: number;
      creditsEarned: number;
      finalScore?: number;
      gradeScaleId?: string;
    },
  ): Promise<void>;
}

/**
 * Optimistic-locking capability for students (F-27). Implemented alongside
 * StudentRepository; kept separate so the base port stays simple and existing
 * fakes are unaffected. `tryUpdate` does `UPDATE ... WHERE id = ? AND version =
 * ?` and throws ConcurrencyError when no row matches (stale version).
 */
export interface VersionedStudentWrites {
  readVersion(id: string): Promise<number | null>;
  tryUpdate(
    id: string,
    patch: Partial<Omit<Student, "id">>,
    expectedVersion: number,
  ): Promise<number>;
}
