import { describe, it, expect, beforeEach } from "vitest";
import {
  CreateStudent,
  ChangeStudentStatus,
  ListStudents,
  DeleteStudent,
} from "../../src/application/use-cases/records/ManageStudents";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { RecordsError } from "../../src/domain/errors/records";
import { ConcurrencyError } from "../../src/domain/errors/persistence";
import { AuthorizationError } from "../../src/domain/errors/auth";
import type { VersionedStudentWrites } from "../../src/domain/repositories/records";
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
    // DEFERRED → SUSPENDED is not in the transition matrix.
    await expect(
      uc.execute({ studentId: s.id, to: "SUSPENDED" }, admin),
    ).rejects.toThrow(/Illegal status transition/);
  });

  it("treats WITHDRAWN as terminal", async () => {
    const s = await makeStudent();
    const uc = new ChangeStudentStatus(students, audit);
    await uc.execute({ studentId: s.id, to: "WITHDRAWN" }, admin);
    await expect(
      uc.execute({ studentId: s.id, to: "ACTIVE" }, admin),
    ).rejects.toThrow(/final and cannot change/);
  });

  it("refuses to set GRADUATED directly (must use the graduation flow)", async () => {
    const s = await makeStudent();
    const uc = new ChangeStudentStatus(students, audit);
    await expect(
      uc.execute({ studentId: s.id, to: "GRADUATED" }, admin),
    ).rejects.toThrow(/graduation clearance flow/);
  });

  it("optimistic locking: a stale version throws ConcurrencyError", async () => {
    const s = await makeStudent();
    // readVersion (load time) = 0, but a concurrent write bumped it to 1.
    const versioned: VersionedStudentWrites = {
      readVersion: async () => 0,
      tryUpdate: async (_id, _patch, expected) => {
        if (expected !== 1) throw new ConcurrencyError();
        return 2;
      },
    };
    const uc = new ChangeStudentStatus(students, audit, versioned);
    await expect(
      uc.execute({ studentId: s.id, to: "SUSPENDED" }, admin),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it("optimistic locking: applies the change when the version matches", async () => {
    const s = await makeStudent();
    let applied = false;
    const versioned: VersionedStudentWrites = {
      readVersion: async () => 0,
      tryUpdate: async (id, patch, expected) => {
        if (expected !== 0) throw new ConcurrencyError();
        await students.update(id, patch);
        applied = true;
        return 1;
      },
    };
    const updated = await new ChangeStudentStatus(
      students,
      audit,
      versioned,
    ).execute({ studentId: s.id, to: "SUSPENDED" }, admin);
    expect(updated.status).toBe("SUSPENDED");
    expect(applied).toBe(true);
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
