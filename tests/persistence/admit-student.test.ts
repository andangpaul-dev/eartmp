import { describe, it, expect } from "vitest";
import { AdmitStudent } from "../../src/application/use-cases/records/AdmitStudent";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { RecordsError } from "../../src/domain/errors/records";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import type {
  UnitOfWork,
  TransactionalRepos,
} from "../../src/application/ports/UnitOfWork";
import type {
  ResultRepository,
  CourseRepository,
} from "../../src/domain/repositories/records";
import { CapturingAudit } from "../auth/fakes";
import { FakeStudentRepo, FakeEnrollmentRepo } from "../records/fakes";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "students.create",
]);
const viewer = SessionContext.create("v", "VIEWER", []);

function makeUow() {
  const students = new FakeStudentRepo();
  const enrollments = new FakeEnrollmentRepo();
  const audit = new CapturingAudit();
  const results = {} as ResultRepository;
  const courses = {} as CourseRepository;
  const uow: UnitOfWork = {
    run<T>(work: (r: TransactionalRepos) => Promise<T>) {
      return work({ students, enrollments, courses, results, audit });
    },
  };
  return { uow, students, enrollments, audit };
}

describe("AdmitStudent", () => {
  it("creates the student and the initial enrollment, and audits", async () => {
    const { uow, students, enrollments, audit } = makeUow();
    const { student, enrollment } = await new AdmitStudent(uow).execute(
      {
        matricNumber: "M/1",
        fullName: "Ada",
        programmeId: "pA",
        levelId: "lA",
        fromSession: "24/25",
      },
      admin,
    );
    expect(student.status).toBe("ACTIVE");
    expect(enrollment.isCurrent).toBe(true);
    expect((await students.findById(student.id))?.matricNumber).toBe("M/1");
    expect((await enrollments.findCurrent(student.id))?.programmeId).toBe("pA");
    expect(audit.entries[0]).toMatchObject({
      action: "ADMIT",
      entity: "Student",
    });
  });

  it("rejects a duplicate live matric number", async () => {
    const { uow } = makeUow();
    const uc = new AdmitStudent(uow);
    const input = {
      matricNumber: "M/1",
      fullName: "Ada",
      programmeId: "pA",
      levelId: "lA",
      fromSession: "24/25",
    };
    await uc.execute(input, admin);
    await expect(uc.execute(input, admin)).rejects.toBeInstanceOf(RecordsError);
  });

  it("is denied without students.create", async () => {
    const { uow } = makeUow();
    await expect(
      authorize(
        new AdmitStudent(uow),
        {
          matricNumber: "M/2",
          fullName: "Z",
          programmeId: "p",
          levelId: "l",
          fromSession: "s",
        },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
