/**
 * Enrollment use-cases (F-22). Opening a new enrollment closes the prior current
 * one, so each student has exactly one current enrollment (AD6.2). The Student
 * row's programmeId/levelId mirror the current enrollment, set in the same
 * use-case (the enrollment is the source of truth). Permission-gated + audited.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { RecordsError } from "../../../domain/errors/records";
import type { StudentEnrollment } from "../../../domain/entities/enrollment";
import type { UnitOfWork, TransactionalRepos } from "../../ports/UnitOfWork";
import type { StudentEnrollmentRepository } from "../../../domain/repositories/records";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

interface OpenEnrollmentInput {
  studentId: string;
  programmeId: string;
  levelId: string;
  fromSession: string;
}

/**
 * Shared logic: close the current enrollment (if any), open a new current one,
 * and mirror placement onto the student row. The three writes run against the
 * transaction's repos so they commit together — a failure can never leave a
 * student with no current enrollment or a stale placement mirror (F-1/F-22).
 */
export async function openEnrollment(
  repos: TransactionalRepos,
  session: SessionContext,
  action: string,
  input: OpenEnrollmentInput,
): Promise<StudentEnrollment> {
  const student = await repos.students.findById(input.studentId);
  if (!student) throw new RecordsError("Student not found.");

  await repos.enrollments.closeCurrent(input.studentId, input.fromSession);
  const created = await repos.enrollments.create({
    studentId: input.studentId,
    programmeId: input.programmeId,
    levelId: input.levelId,
    fromSession: input.fromSession,
    isCurrent: true,
  });
  // Mirror placement onto the student row.
  await repos.students.update(input.studentId, {
    programmeId: input.programmeId,
    levelId: input.levelId,
  });
  await repos.audit.record({
    userId: session.actorId,
    action,
    entity: "StudentEnrollment",
    recordId: created.id,
    newValue: {
      studentId: input.studentId,
      programmeId: input.programmeId,
      levelId: input.levelId,
    },
  });
  return created;
}

export type EnrollStudentInput = OpenEnrollmentInput;
export class EnrollStudent implements AuthorizedUseCase<
  EnrollStudentInput,
  StudentEnrollment
> {
  readonly name = "EnrollStudent";
  readonly requiredPermissions = ["students.update"];
  constructor(private readonly uow: UnitOfWork) {}
  execute(input: EnrollStudentInput, session: SessionContext) {
    return this.uow.run((repos) =>
      openEnrollment(repos, session, "ENROLL", input),
    );
  }
}

export interface TransferStudentInput {
  studentId: string;
  toProgrammeId: string;
  toLevelId: string;
  asOfSession: string;
}
export class TransferStudent implements AuthorizedUseCase<
  TransferStudentInput,
  StudentEnrollment
> {
  readonly name = "TransferStudent";
  readonly requiredPermissions = ["students.update"];
  constructor(private readonly uow: UnitOfWork) {}
  async execute(input: TransferStudentInput, session: SessionContext) {
    return this.uow.run(async (repos) => {
      const current = await repos.enrollments.findCurrent(input.studentId);
      if (!current) {
        throw new RecordsError(
          "Cannot transfer a student with no current enrollment.",
        );
      }
      return openEnrollment(repos, session, "TRANSFER", {
        studentId: input.studentId,
        programmeId: input.toProgrammeId,
        levelId: input.toLevelId,
        fromSession: input.asOfSession,
      });
    });
  }
}

export interface GetEnrollmentHistoryInput {
  studentId: string;
}
export class GetEnrollmentHistory implements AuthorizedUseCase<
  GetEnrollmentHistoryInput,
  StudentEnrollment[]
> {
  readonly name = "GetEnrollmentHistory";
  readonly requiredPermissions = ["students.read"];
  constructor(private readonly enrollments: StudentEnrollmentRepository) {}
  async execute(input: GetEnrollmentHistoryInput, _session: SessionContext) {
    return this.enrollments.listByStudent(input.studentId);
  }
}
