/**
 * ReadmitStudent — re-admit a student who was previously WITHDRAWN or GRADUATED
 * (Phase 5, Workstream C).
 *
 * WITHDRAWN: the student's existing record is reactivated (same id, same
 * matricNumber, same admissionSession). A new current enrollment is opened.
 *
 * GRADUATED: a brand-new student record is created with a freshly reserved
 * matricule, copying personal fields from the original and back-linking via
 * previousStudentId. A new current enrollment is opened for the new record.
 *
 * All other statuses (ACTIVE, SUSPENDED, DEFERRED) are rejected.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { RecordsError } from "../../../domain/errors/records";
import type { Student } from "../../../domain/entities";
import type { UnitOfWork } from "../../ports/UnitOfWork";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";
import type { GenerateMatricule } from "../../services/GenerateMatricule";
import {
  requireInScope,
  requireInFacultyScope,
} from "../../authorization/institutionScope";
import { openEnrollment } from "./ManageEnrollment";

export interface ReadmitStudentInput {
  studentId: string;
  programmeId: string;
  levelId: string;
  fromSession: string;
  facultyId?: string;
  departmentId?: string;
}

export class ReadmitStudent implements AuthorizedUseCase<
  ReadmitStudentInput,
  Student
> {
  readonly name = "ReadmitStudent";
  readonly requiredPermissions = ["students.update"];

  constructor(
    private readonly uow: UnitOfWork,
    private readonly generate: GenerateMatricule,
  ) {}

  async execute(
    input: ReadmitStudentInput,
    session: SessionContext,
  ): Promise<Student> {
    return this.uow.run(async (repos) => {
      const student = await repos.students.findById(input.studentId);
      if (!student) throw new RecordsError("Student not found.");

      requireInScope(student.institutionId, session);
      requireInFacultyScope(student.facultyId, session);

      if (student.status === "WITHDRAWN") {
        // Reactivate the existing record in-place.
        await repos.students.update(student.id, { status: "ACTIVE" });

        await openEnrollment(repos, session, "READMIT", {
          studentId: student.id,
          programmeId: input.programmeId,
          levelId: input.levelId,
          fromSession: input.fromSession,
        });

        // Re-read to return the fully up-to-date row (openEnrollment also
        // patches programmeId/levelId onto the student via repos.students.update).
        const updated = await repos.students.findById(student.id);
        if (!updated) throw new RecordsError("Student not found after update.");

        await repos.audit.record({
          userId: session.actorId,
          action: "READMIT",
          entity: "Student",
          recordId: updated.id,
          newValue: {
            matricNumber: updated.matricNumber,
            status: "ACTIVE",
            programmeId: input.programmeId,
            fromSession: input.fromSession,
          },
        });

        return updated;
      }

      if (student.status === "GRADUATED") {
        // Generate a new matricule for a brand-new student record.
        const effectiveFacultyId = input.facultyId ?? student.facultyId;
        if (!effectiveFacultyId) {
          throw new RecordsError(
            "facultyId is required when re-admitting a graduated student.",
            { facultyId: "facultyId is required." },
          );
        }

        const matric = await this.generate.generate(
          {
            institutionId: null,
            facultyId: effectiveFacultyId,
            departmentId: input.departmentId ?? student.departmentId,
            admissionSession: input.fromSession,
          },
          repos,
          "reserve",
        );

        // Create a new student record, copying personal fields from the original.
        const newStudent = await repos.students.create({
          matricNumber: matric,
          fullName: student.fullName,
          regNumber: student.regNumber,
          gender: student.gender,
          dateOfBirth: student.dateOfBirth,
          nationality: student.nationality,
          address: student.address,
          telephone: student.telephone,
          email: student.email,
          programmeId: input.programmeId,
          levelId: input.levelId,
          facultyId: input.facultyId ?? student.facultyId,
          departmentId: input.departmentId ?? student.departmentId,
          institutionId: student.institutionId,
          admissionSession: input.fromSession,
          previousStudentId: student.id,
          status: "ACTIVE",
        });

        await openEnrollment(repos, session, "READMIT", {
          studentId: newStudent.id,
          programmeId: input.programmeId,
          levelId: input.levelId,
          fromSession: input.fromSession,
        });

        await repos.audit.record({
          userId: session.actorId,
          action: "READMIT",
          entity: "Student",
          recordId: newStudent.id,
          newValue: {
            matricNumber: newStudent.matricNumber,
            previousStudentId: student.id,
            programmeId: input.programmeId,
            fromSession: input.fromSession,
          },
        });

        return newStudent;
      }

      throw new RecordsError(
        "Only withdrawn or graduated students can be re-admitted.",
      );
    });
  }
}
