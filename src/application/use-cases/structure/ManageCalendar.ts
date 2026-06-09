/**
 * Academic-calendar use-cases: sessions and semesters. Permission-gated
 * (`structure.manage` for writes, `structure.read` for reads) and audited.
 * Invariants: session names unique among live rows; exactly one current
 * session (AD5.5); `Semester(sessionId, rank)` unique.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { StructureError } from "../../../domain/errors/structure";
import { StructureRules } from "../../../domain/entities/structure";
import type {
  AcademicSession,
  Semester,
} from "../../../domain/entities/structure";
import type {
  AcademicSessionRepository,
  SemesterRepository,
} from "../../../domain/repositories/structure";
import type { AuditLogPort } from "../../../domain/repositories";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

const MANAGE = ["structure.manage"];
const READ = ["structure.read"];

export interface CreateSessionInput {
  name: string;
  startDate?: Date;
  endDate?: Date;
}
export class CreateSession implements AuthorizedUseCase<
  CreateSessionInput,
  AcademicSession
> {
  readonly name = "CreateSession";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly sessions: AcademicSessionRepository,
    private readonly auditLog: AuditLogPort,
  ) {}
  async execute(input: CreateSessionInput, session: SessionContext) {
    StructureRules.requireNonEmpty(input.name, "Session name");
    if (await this.sessions.findByName(input.name)) {
      throw new StructureError(`Session "${input.name}" already exists.`);
    }
    const created = await this.sessions.create({
      name: input.name,
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
      isCurrent: false,
    });
    await this.auditLog.record({
      userId: session.actorId,
      action: "CREATE",
      entity: "AcademicSession",
      recordId: created.id,
      newValue: { name: created.name },
    });
    return created;
  }
}

export interface SetCurrentSessionInput {
  id: string;
}
export class SetCurrentSession implements AuthorizedUseCase<
  SetCurrentSessionInput,
  void
> {
  readonly name = "SetCurrentSession";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly sessions: AcademicSessionRepository,
    private readonly auditLog: AuditLogPort,
  ) {}
  async execute(input: SetCurrentSessionInput, session: SessionContext) {
    const target = await this.sessions.findById(input.id);
    if (!target) throw new StructureError("Session not found.");
    await this.sessions.update(input.id, { isCurrent: true });
    await this.sessions.clearCurrentExcept(input.id);
    await this.auditLog.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "AcademicSession",
      recordId: input.id,
      newValue: { isCurrent: true },
    });
  }
}

export class ListSessions implements AuthorizedUseCase<
  Record<string, never>,
  AcademicSession[]
> {
  readonly name = "ListSessions";
  readonly requiredPermissions = READ;
  constructor(private readonly sessions: AcademicSessionRepository) {}
  async execute(
    _input: Record<string, never>,
    _session: SessionContext,
  ): Promise<AcademicSession[]> {
    return this.sessions.list();
  }
}

export interface CreateSemesterInput {
  name: string;
  rank: number;
  sessionId: string;
}
export class CreateSemester implements AuthorizedUseCase<
  CreateSemesterInput,
  Semester
> {
  readonly name = "CreateSemester";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly semesters: SemesterRepository,
    private readonly sessions: AcademicSessionRepository,
    private readonly auditLog: AuditLogPort,
  ) {}
  async execute(input: CreateSemesterInput, session: SessionContext) {
    StructureRules.requireNonEmpty(input.name, "Semester name");
    StructureRules.requirePositiveRank(input.rank);
    if (!(await this.sessions.findById(input.sessionId))) {
      throw new StructureError("Parent session does not exist or is deleted.");
    }
    if (await this.semesters.existsRank(input.sessionId, input.rank)) {
      throw new StructureError(
        `A semester with rank ${input.rank} already exists in this session.`,
      );
    }
    const created = await this.semesters.create({
      name: input.name,
      rank: input.rank,
      sessionId: input.sessionId,
    });
    await this.auditLog.record({
      userId: session.actorId,
      action: "CREATE",
      entity: "Semester",
      recordId: created.id,
      newValue: { rank: created.rank, sessionId: created.sessionId },
    });
    return created;
  }
}

export interface ListSemestersInput {
  sessionId: string;
}
export class ListSemesters implements AuthorizedUseCase<
  ListSemestersInput,
  Semester[]
> {
  readonly name = "ListSemesters";
  readonly requiredPermissions = READ;
  constructor(private readonly semesters: SemesterRepository) {}
  async execute(input: ListSemestersInput) {
    return this.semesters.listBySession(input.sessionId);
  }
}
