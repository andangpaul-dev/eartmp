/**
 * RegenerateMatricule — replace a student's matricule with a freshly-reserved
 * number from the same (faculty, admission-year) sequence.
 *
 * Guard: refused when the student has any APPROVED or LOCKED transcripts,
 * because regenerating the matricule would invalidate the signed documents.
 *
 * The reusable `regenerateOne` helper runs inside an existing transaction's
 * repos so it can be composed by other use-cases (e.g. ReadmitStudent) without
 * opening a second transaction.
 */
import type { Student } from "../../../domain/entities";
import { RecordsError } from "../../../domain/errors/records";
import type { SessionContext } from "../../../domain/value-objects/SessionContext";
import type { UnitOfWork, TransactionalRepos } from "../../ports/UnitOfWork";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";
import type { GenerateMatricule } from "../../services/GenerateMatricule";
import {
  requireInScope,
  requireInFacultyScope,
} from "../../authorization/institutionScope";

/**
 * Core regeneration logic — does NOT open its own transaction; call this from
 * inside a `uow.run` callback so changes are part of the caller's transaction.
 */
export async function regenerateOne(
  repos: TransactionalRepos,
  generate: GenerateMatricule,
  student: Student,
  session: SessionContext,
): Promise<string> {
  if ((await repos.transcripts.countIssuedByStudent(student.id)) > 0) {
    throw new RecordsError(
      "Cannot regenerate the matricule: this student has issued transcripts.",
    );
  }
  if (!student.facultyId) {
    throw new RecordsError("Student has no faculty for matricule generation.");
  }
  if (!student.admissionSession) {
    throw new RecordsError("Student has no admission session.");
  }

  const matric = await generate.generate(
    {
      institutionId: null,
      facultyId: student.facultyId,
      departmentId: student.departmentId,
      admissionSession: student.admissionSession,
    },
    repos,
    "reserve",
  );

  const old = student.matricNumber;
  await repos.students.update(student.id, { matricNumber: matric });
  await repos.audit.record({
    userId: session.actorId,
    action: "UPDATE",
    entity: "Student",
    recordId: student.id,
    oldValue: { matricNumber: old },
    newValue: { matricNumber: matric },
  });

  return matric;
}

export interface RegenerateMatriculeInput {
  studentId: string;
}

export class RegenerateMatricule implements AuthorizedUseCase<
  RegenerateMatriculeInput,
  { matricule: string }
> {
  readonly name = "RegenerateMatricule";
  readonly requiredPermissions = ["students.update"];

  constructor(
    private readonly uow: UnitOfWork,
    private readonly generate: GenerateMatricule,
  ) {}

  async execute(
    input: RegenerateMatriculeInput,
    session: SessionContext,
  ): Promise<{ matricule: string }> {
    return this.uow.run(async (repos) => {
      const student = await repos.students.findById(input.studentId);
      if (!student) {
        throw new RecordsError("Student not found.");
      }

      requireInScope(student.institutionId, session);
      requireInFacultyScope(student.facultyId, session);

      const matricule = await regenerateOne(
        repos,
        this.generate,
        student,
        session,
      );
      return { matricule };
    });
  }
}
