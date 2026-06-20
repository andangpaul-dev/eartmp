/**
 * PrismaUnitOfWork — DEV-ONLY UnitOfWork impl using Prisma interactive
 * transactions (ADR-7.1). `run` opens a `$transaction`, builds a repository
 * bundle bound to the transaction client, runs the work, and commits; any throw
 * rolls the whole transaction back. The future Tauri-SQL impl satisfies the same
 * port (BEGIN/COMMIT/ROLLBACK around the same repositories).
 */
import type { PrismaClient } from "@prisma/client";
import type {
  UnitOfWork,
  TransactionalRepos,
} from "../../application/ports/UnitOfWork";
import {
  PrismaStudentRepository,
  PrismaCourseRepository,
  PrismaStudentEnrollmentRepository,
  PrismaResultRepository,
  PrismaSemesterOrdering,
  PrismaMatriculeCounter,
} from "../repositories/PrismaRecordsRepositories";
import { PrismaAuditLogAdapter } from "../repositories/PrismaAuthRepositories";

export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly db: PrismaClient) {}

  run<T>(work: (repos: TransactionalRepos) => Promise<T>): Promise<T> {
    return this.db.$transaction((tx) =>
      work({
        students: new PrismaStudentRepository(tx),
        enrollments: new PrismaStudentEnrollmentRepository(tx),
        courses: new PrismaCourseRepository(tx),
        results: new PrismaResultRepository(tx),
        audit: new PrismaAuditLogAdapter(tx),
        semesterOrdering: new PrismaSemesterOrdering(tx),
        matriculeCounter: new PrismaMatriculeCounter(tx),
      }),
    );
  }
}
