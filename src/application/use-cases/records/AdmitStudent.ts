/**
 * AdmitStudent — create a student record and their initial enrollment as ONE
 * atomic operation (architecture review F-1 / ADR-7.2). If the enrollment write
 * fails, the student create rolls back too — no orphaned student without a
 * placement. Permission-gated and audited.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { RecordsError } from "../../../domain/errors/records";
import type { Student } from "../../../domain/entities";
import type { StudentEnrollment } from "../../../domain/entities/enrollment";
import type { UnitOfWork } from "../../ports/UnitOfWork";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

export interface AdmitStudentInput {
  matricNumber: string;
  fullName: string;
  regNumber?: string;
  programmeId: string;
  levelId: string;
  fromSession: string;
}

export interface AdmitStudentResult {
  student: Student;
  enrollment: StudentEnrollment;
}

export class AdmitStudent implements AuthorizedUseCase<
  AdmitStudentInput,
  AdmitStudentResult
> {
  readonly name = "AdmitStudent";
  readonly requiredPermissions = ["students.create"];

  constructor(private readonly uow: UnitOfWork) {}

  async execute(
    input: AdmitStudentInput,
    session: SessionContext,
  ): Promise<AdmitStudentResult> {
    if (input.matricNumber.trim().length === 0) {
      throw new RecordsError("Matric number must not be empty.");
    }
    return this.uow.run(async (repos) => {
      if (await repos.students.findByMatric(input.matricNumber)) {
        throw new RecordsError(
          `Matric number "${input.matricNumber}" is already in use.`,
        );
      }
      const student = await repos.students.create({
        matricNumber: input.matricNumber,
        fullName: input.fullName,
        regNumber: input.regNumber,
        programmeId: input.programmeId,
        levelId: input.levelId,
        status: "ACTIVE",
      });
      const enrollment = await repos.enrollments.create({
        studentId: student.id,
        programmeId: input.programmeId,
        levelId: input.levelId,
        fromSession: input.fromSession,
        isCurrent: true,
      });
      await repos.audit.record({
        userId: session.actorId,
        action: "ADMIT",
        entity: "Student",
        recordId: student.id,
        newValue: {
          matricNumber: student.matricNumber,
          programmeId: input.programmeId,
        },
      });
      return { student, enrollment };
    });
  }
}
