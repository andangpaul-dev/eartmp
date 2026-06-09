/**
 * UnitOfWork — a transaction boundary (architecture review F-1 / ADR-7.1).
 *
 * `run(work)` executes the callback inside a single database transaction,
 * providing a bundle of repositories bound to that transaction. Everything the
 * callback writes commits together on success and rolls back together on any
 * throw — so a multi-write use-case can never leave a half-written state.
 *
 * The port is implementation-agnostic: the Prisma-backed impl (dev) and the
 * future Tauri-SQL impl (shell phase) both satisfy it; use-cases depend only on
 * this interface.
 */
import type {
  StudentRepository,
  CourseRepository,
  StudentEnrollmentRepository,
  ResultRepository,
} from "../../domain/repositories/records";
import type { AuditLogPort } from "../../domain/repositories";

export interface TransactionalRepos {
  students: StudentRepository;
  enrollments: StudentEnrollmentRepository;
  courses: CourseRepository;
  results: ResultRepository;
  audit: AuditLogPort;
}

export interface UnitOfWork {
  run<T>(work: (repos: TransactionalRepos) => Promise<T>): Promise<T>;
}
