/**
 * Composition wiring for the dev (Prisma) persistence layer (ADR-5/AD7.1). This
 * is the single place that binds the persistence ports to their concrete
 * Prisma-backed implementations + the UnitOfWork. The shell phase swaps these
 * registrations for the Tauri-SQL implementations without touching call sites.
 *
 * Token constants avoid stringly-typed typos at call sites.
 */
import type { PrismaClient } from "@prisma/client";
import { PrismaUnitOfWork } from "../persistence/PrismaUnitOfWork";
import {
  PrismaStudentRepository,
  PrismaCourseRepository,
  PrismaStudentEnrollmentRepository,
  PrismaResultRepository,
} from "../repositories/PrismaRecordsRepositories";
import type { Container } from "./container";

export const TOKENS = {
  UnitOfWork: "UnitOfWork",
  StudentRepository: "StudentRepository",
  CourseRepository: "CourseRepository",
  StudentEnrollmentRepository: "StudentEnrollmentRepository",
  ResultRepository: "ResultRepository",
} as const;

/** Register the dev persistence layer (Prisma) into the container. */
export function wirePersistence(container: Container, db: PrismaClient): void {
  container.register(TOKENS.UnitOfWork, () => new PrismaUnitOfWork(db));
  container.register(
    TOKENS.StudentRepository,
    () => new PrismaStudentRepository(db),
  );
  container.register(
    TOKENS.CourseRepository,
    () => new PrismaCourseRepository(db),
  );
  container.register(
    TOKENS.StudentEnrollmentRepository,
    () => new PrismaStudentEnrollmentRepository(db),
  );
  container.register(
    TOKENS.ResultRepository,
    () => new PrismaResultRepository(db),
  );
}
