import { describe, it, expect, beforeEach } from "vitest";
import {
  EnrollStudent,
  TransferStudent,
  GetEnrollmentHistory,
} from "../../src/application/use-cases/records/ManageEnrollment";
import { CreateStudent } from "../../src/application/use-cases/records/ManageStudents";
import { RecordsError } from "../../src/domain/errors/records";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { CapturingAudit } from "../auth/fakes";
import type {
  UnitOfWork,
  TransactionalRepos,
} from "../../src/application/ports/UnitOfWork";
import { FakeStudentRepo, FakeEnrollmentRepo } from "./fakes";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "students.create",
  "students.read",
  "students.update",
]);

let students: FakeStudentRepo;
let enrollments: FakeEnrollmentRepo;
let audit: CapturingAudit;
let uow: UnitOfWork;
beforeEach(() => {
  students = new FakeStudentRepo();
  enrollments = new FakeEnrollmentRepo();
  audit = new CapturingAudit();
  uow = {
    run: (work) =>
      work({ students, enrollments, audit } as unknown as TransactionalRepos),
  };
});

async function makeStudent() {
  return new CreateStudent(students, audit).execute(
    { matricNumber: "M/1", fullName: "Ada" },
    admin,
  );
}

describe("EnrollStudent / TransferStudent", () => {
  it("enroll opens a current enrollment and mirrors placement on the student", async () => {
    const s = await makeStudent();
    await new EnrollStudent(uow).execute(
      {
        studentId: s.id,
        programmeId: "pA",
        levelId: "lA",
        fromSession: "24/25",
      },
      admin,
    );
    const current = await enrollments.findCurrent(s.id);
    expect(current?.programmeId).toBe("pA");
    expect((await students.findById(s.id))?.programmeId).toBe("pA");
  });

  it("transfer closes the prior current and opens a new one (single current)", async () => {
    const s = await makeStudent();
    await new EnrollStudent(uow).execute(
      {
        studentId: s.id,
        programmeId: "pA",
        levelId: "lA",
        fromSession: "24/25",
      },
      admin,
    );
    await new TransferStudent(uow).execute(
      {
        studentId: s.id,
        toProgrammeId: "pB",
        toLevelId: "lB",
        asOfSession: "25/26",
      },
      admin,
    );
    const history = await new GetEnrollmentHistory(enrollments).execute(
      { studentId: s.id },
      admin,
    );
    expect(history).toHaveLength(2);
    expect(history.filter((e) => e.isCurrent)).toHaveLength(1);
    expect(history.find((e) => e.isCurrent)?.programmeId).toBe("pB");
    expect(history.find((e) => !e.isCurrent)?.toSession).toBe("25/26");
  });

  it("rejects transfer with no current enrollment", async () => {
    const s = await makeStudent();
    await expect(
      new TransferStudent(uow).execute(
        {
          studentId: s.id,
          toProgrammeId: "pB",
          toLevelId: "lB",
          asOfSession: "25/26",
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(RecordsError);
  });
});
