import { describe, it, expect, beforeEach } from "vitest";
import {
  CreateStudent,
  ChangeStudentStatus,
  ListStudents,
  DeleteStudent,
} from "../../src/application/use-cases/records/ManageStudents";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { RecordsError } from "../../src/domain/errors/records";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { CapturingAudit } from "../auth/fakes";
import { FakeStudentRepo } from "./fakes";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "students.create",
  "students.read",
  "students.update",
]);
const viewer = SessionContext.create("v", "VIEWER", ["students.read"]);

let students: FakeStudentRepo;
let audit: CapturingAudit;
beforeEach(() => {
  students = new FakeStudentRepo();
  audit = new CapturingAudit();
});

describe("CreateStudent", () => {
  it("creates ACTIVE; rejects empty + duplicate live matric; reuse after delete", async () => {
    const uc = new CreateStudent(students, audit);
    const s = await uc.execute({ matricNumber: "M/1", fullName: "Ada" }, admin);
    expect(s.status).toBe("ACTIVE");
    expect(audit.entries[0]).toMatchObject({
      action: "CREATE",
      entity: "Student",
    });
    await expect(
      uc.execute({ matricNumber: "", fullName: "X" }, admin),
    ).rejects.toBeInstanceOf(RecordsError);
    await expect(
      uc.execute({ matricNumber: "M/1", fullName: "Dup" }, admin),
    ).rejects.toThrow(/already in use/);
    await new DeleteStudent(students, audit).execute({ id: s.id }, admin);
    const again = await uc.execute(
      { matricNumber: "M/1", fullName: "Ada2" },
      admin,
    );
    expect(again.id).not.toBe(s.id);
  });

  it("is denied without students.create", async () => {
    await expect(
      authorize(
        new CreateStudent(students, audit),
        { matricNumber: "M/2", fullName: "Z" },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("ChangeStudentStatus (workflow)", () => {
  async function makeStudent() {
    return new CreateStudent(students, audit).execute(
      { matricNumber: "M/9", fullName: "Grace" },
      admin,
    );
  }

  it("applies a legal transition and audits old→new", async () => {
    const s = await makeStudent();
    const uc = new ChangeStudentStatus(students, audit);
    const updated = await uc.execute(
      { studentId: s.id, to: "DEFERRED" },
      admin,
    );
    expect(updated.status).toBe("DEFERRED");
    const last = audit.entries[audit.entries.length - 1]!;
    expect(last.oldValue).toEqual({ status: "ACTIVE" });
    expect(last.newValue).toEqual({ status: "DEFERRED" });
  });

  it("rejects an illegal transition", async () => {
    const s = await makeStudent();
    const uc = new ChangeStudentStatus(students, audit);
    await uc.execute({ studentId: s.id, to: "DEFERRED" }, admin);
    await expect(
      uc.execute({ studentId: s.id, to: "GRADUATED" }, admin),
    ).rejects.toThrow(/Illegal status transition/);
  });

  it("treats GRADUATED/WITHDRAWN as terminal", async () => {
    const s = await makeStudent();
    const uc = new ChangeStudentStatus(students, audit);
    await uc.execute({ studentId: s.id, to: "GRADUATED" }, admin);
    await expect(
      uc.execute({ studentId: s.id, to: "ACTIVE" }, admin),
    ).rejects.toThrow(/final and cannot change/);
  });
});

describe("ListStudents (pagination + filter)", () => {
  it("returns a page with the total, filtered by search", async () => {
    const create = new CreateStudent(students, audit);
    for (let i = 1; i <= 3; i++) {
      await create.execute(
        { matricNumber: `CS/${i}`, fullName: `S${i}` },
        admin,
      );
    }
    await create.execute({ matricNumber: "EE/1", fullName: "Other" }, admin);
    const page = await new ListStudents(students).execute(
      { where: { search: "CS/" }, take: 2 },
      admin,
    );
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(2);
  });
});
