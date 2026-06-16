import { describe, it, expect, beforeEach } from "vitest";
import { ImportStudents } from "../../src/application/use-cases/records/ImportStudents";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { fakeUow } from "../results/fakes";
import { FakeStudentRepo } from "./fakes";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "students.create",
]);

let students: FakeStudentRepo;
let uc: ImportStudents;
beforeEach(() => {
  students = new FakeStudentRepo();
  uc = new ImportStudents(fakeUow({ students }));
});

describe("ImportStudents", () => {
  it("imports a clean batch with the chosen placement", async () => {
    const report = await uc.execute(
      {
        rows: [
          { matricNumber: "M/1", fullName: "Ada", regNumber: "R1" },
          { matricNumber: "M/2", fullName: "Bo" },
        ],
        facultyId: "f1",
        departmentId: "d1",
        subDepartmentId: "sd1",
        admissionSession: "24/25",
      },
      admin,
    );
    expect(report.imported).toBe(2);
    expect(report.errors).toHaveLength(0);
    const ada = (await students.find({})).items.find(
      (s) => s.matricNumber === "M/1",
    )!;
    expect(ada.departmentId).toBe("d1");
    expect(ada.subDepartmentId).toBe("sd1");
    expect(ada.admissionSession).toBe("24/25");
    expect(ada.status).toBe("ACTIVE");
  });

  it("is all-or-nothing: a missing name means nothing is written", async () => {
    const report = await uc.execute(
      {
        rows: [
          { matricNumber: "M/1", fullName: "Ada" },
          { matricNumber: "M/2", fullName: "" }, // missing name
        ],
        facultyId: "f1",
      },
      admin,
    );
    expect(report.imported).toBe(0);
    expect(report.errors[0]).toMatchObject({ row: 2 });
    expect((await students.find({})).total).toBe(0);
  });

  it("flags in-file duplicates and existing matric numbers", async () => {
    await students.create({
      matricNumber: "M/9",
      fullName: "Existing",
      status: "ACTIVE",
    });
    const report = await uc.execute(
      {
        rows: [
          { matricNumber: "M/1", fullName: "A" },
          { matricNumber: "M/1", fullName: "B" }, // duplicate in file
          { matricNumber: "M/9", fullName: "C" }, // already exists
        ],
      },
      admin,
    );
    expect(report.imported).toBe(0);
    expect(report.errors.map((e) => e.row).sort()).toEqual([2, 3]);
    expect(report.errors.find((e) => e.row === 2)!.messages.join()).toMatch(
      /Duplicate/,
    );
    expect(report.errors.find((e) => e.row === 3)!.messages.join()).toMatch(
      /already exists/,
    );
  });

  it("dry run validates and reports without writing", async () => {
    const report = await uc.execute(
      {
        rows: [{ matricNumber: "M/1", fullName: "Ada" }],
        dryRun: true,
      },
      admin,
    );
    expect(report.validRows).toBe(1);
    expect(report.imported).toBe(0);
    expect((await students.find({})).total).toBe(0);
  });

  it("accepts alternate header names (matric / name)", async () => {
    const report = await uc.execute(
      { rows: [{ matric: "M/7", name: "Grace" }] },
      admin,
    );
    expect(report.imported).toBe(1);
  });

  it("is denied through the seam without students.create", async () => {
    const viewer = SessionContext.create("v", "VIEWER", ["students.read"]);
    await expect(authorize(uc, { rows: [] }, viewer)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});
