/**
 * Repository interfaces (ports). The domain/application layers depend on these
 * abstractions; infrastructure provides Prisma-backed implementations. This is
 * the dependency-inversion boundary required by Clean Architecture.
 *
 * Phase 7 reconciliation: the student/course/result ports now live in
 * `./records.ts` (canonical, paginated). This file keeps the append-only
 * `AuditLogPort`, the generic `Repository<T>`, and the `TranscriptRepository`
 * (built out in Phase 12).
 */

import type { Transcript } from "../entities";

export interface Repository<T> {
  findById(id: string): Promise<T | null>;
  findAll(): Promise<T[]>;
  create(entity: Omit<T, "id">): Promise<T>;
  update(id: string, patch: Partial<T>): Promise<T>;
  softDelete(id: string): Promise<void>;
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
