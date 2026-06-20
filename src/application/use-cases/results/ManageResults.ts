/**
 * Result entry, locking, and reads (Phase 9). `EnterResult` computes the final
 * score via the configured assessment structure (AD9.1), dedupes on
 * (student, course, semester) (AD9.4), and refuses to touch a locked result
 * (AD9.3). Locking is the integrity gate: `LockSemesterResults` locks a
 * semester; `UnlockResult` reopens a single result through an audited workflow
 * gated by the distinct `results.unlock` permission.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { RecordsError } from "../../../domain/errors/records";
import type { ResultRecord } from "../../../domain/entities";
import type {
  ResultRepository,
  StudentRepository,
} from "../../../domain/repositories/records";
import type { AuditLogPort } from "../../../domain/repositories";
import type { GradingConfigService } from "../../services/GradingConfigService";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";
import {
  requireInScope,
  requireInFacultyScope,
} from "../../authorization/institutionScope";

/**
 * A result operation targets a student; when a student repository is wired (the
 * host always wires it) confirm the student is within the operator's institution
 * AND faculty access before touching their results. Optional so pure result-logic
 * unit tests need no student fixture; production enforcement is host-wired.
 */
async function guardStudentScope(
  students: StudentRepository | undefined,
  studentId: string,
  session: SessionContext,
): Promise<void> {
  if (!students) return;
  const student = await students.findById(studentId);
  if (!student) throw new RecordsError("Student not found.");
  requireInScope(student.institutionId, session);
  requireInFacultyScope(student.facultyId, session);
}

export interface EnterResultInput {
  studentId: string;
  courseId: string;
  semesterId: string;
  componentScores: { key: string; score: number }[];
}

export class EnterResult implements AuthorizedUseCase<
  EnterResultInput,
  ResultRecord
> {
  readonly name = "EnterResult";
  readonly requiredPermissions = ["results.process"];

  constructor(
    private readonly results: ResultRepository,
    private readonly grading: GradingConfigService,
    private readonly audit: AuditLogPort,
    private readonly students?: StudentRepository,
  ) {}

  async execute(
    input: EnterResultInput,
    session: SessionContext,
  ): Promise<ResultRecord> {
    await guardStudentScope(this.students, input.studentId, session);
    // Compute the final score via the configured assessment structure. The value
    // object validates component keys/ranges/completeness.
    const structure = await this.grading.loadAssessmentStructure();
    const finalScore = structure.computeFinalScore(input.componentScores);

    const existing = (
      await this.results.findByStudentAndSemester(
        input.studentId,
        input.semesterId,
      )
    ).find((r) => r.courseId === input.courseId);

    if (existing?.isLocked) {
      throw new RecordsError(
        "This result is locked; unlock it before editing scores.",
      );
    }

    if (existing) {
      await this.results.updateScores(existing.id, {
        componentScores: input.componentScores,
        finalScore,
      });
      await this.audit.record({
        userId: session.actorId,
        action: "UPDATE",
        entity: "Result",
        recordId: existing.id,
        newValue: { finalScore },
      });
      return {
        ...existing,
        componentScores: input.componentScores,
        finalScore,
      };
    }

    const created = await this.results.create({
      studentId: input.studentId,
      courseId: input.courseId,
      semesterId: input.semesterId,
      componentScores: input.componentScores,
      finalScore,
      isLocked: false,
    });
    await this.audit.record({
      userId: session.actorId,
      action: "CREATE",
      entity: "Result",
      recordId: created.id,
      newValue: { courseId: created.courseId, finalScore },
    });
    return created;
  }
}

export interface LockSemesterResultsInput {
  studentId: string;
  semesterId: string;
}
export class LockSemesterResults implements AuthorizedUseCase<
  LockSemesterResultsInput,
  number
> {
  readonly name = "LockSemesterResults";
  readonly requiredPermissions = ["results.process"];
  constructor(
    private readonly results: ResultRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: LockSemesterResultsInput, session: SessionContext) {
    const count = await this.results.setLockedForSemester(
      input.studentId,
      input.semesterId,
      true,
    );
    await this.audit.record({
      userId: session.actorId,
      action: "LOCK",
      entity: "Result",
      recordId: input.studentId,
      newValue: { semesterId: input.semesterId, locked: count },
    });
    return count;
  }
}

export interface UnlockResultInput {
  resultId: string;
}
export class UnlockResult implements AuthorizedUseCase<
  UnlockResultInput,
  void
> {
  readonly name = "UnlockResult";
  readonly requiredPermissions = ["results.unlock"];
  constructor(
    private readonly results: ResultRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: UnlockResultInput, session: SessionContext) {
    const result = await this.results.findById(input.resultId);
    if (!result) throw new RecordsError("Result not found.");
    await this.results.unlock(input.resultId);
    await this.audit.record({
      userId: session.actorId,
      action: "UNLOCK",
      entity: "Result",
      recordId: input.resultId,
      oldValue: { isLocked: true },
      newValue: { isLocked: false },
    });
  }
}

export interface GetStudentSemesterResultsInput {
  studentId: string;
  semesterId: string;
}
export class GetStudentSemesterResults implements AuthorizedUseCase<
  GetStudentSemesterResultsInput,
  ResultRecord[]
> {
  readonly name = "GetStudentSemesterResults";
  readonly requiredPermissions = ["results.read"];
  constructor(
    private readonly results: ResultRepository,
    private readonly students?: StudentRepository,
  ) {}
  async execute(
    input: GetStudentSemesterResultsInput,
    session: SessionContext,
  ) {
    await guardStudentScope(this.students, input.studentId, session);
    return this.results.findByStudentAndSemester(
      input.studentId,
      input.semesterId,
    );
  }
}

export interface GetStudentResultsInput {
  studentId: string;
}
export class GetStudentResults implements AuthorizedUseCase<
  GetStudentResultsInput,
  ResultRecord[]
> {
  readonly name = "GetStudentResults";
  readonly requiredPermissions = ["results.read"];
  constructor(private readonly results: ResultRepository) {}
  async execute(input: GetStudentResultsInput, _session: SessionContext) {
    return this.results.findByStudent(input.studentId);
  }
}
