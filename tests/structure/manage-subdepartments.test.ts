import { describe, it, expect, beforeEach } from "vitest";
import {
  CreateSubDepartment,
  UpdateSubDepartment,
  DeleteSubDepartment,
  ListSubDepartments,
} from "../../src/application/use-cases/structure/ManageSubDepartments";
import { DeleteDepartment } from "../../src/application/use-cases/structure/ManageStructure";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { StructureError } from "../../src/domain/errors/structure";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { CapturingAudit } from "../auth/fakes";
import {
  FakeFacultyRepo,
  FakeDepartmentRepo,
  FakeSubDepartmentRepo,
  FakeProgrammeRepo,
} from "./fakes";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "structure.read",
  "structure.manage",
]);
const viewer = SessionContext.create("v", "VIEWER", ["structure.read"]);

let faculties: FakeFacultyRepo;
let departments: FakeDepartmentRepo;
let subDepartments: FakeSubDepartmentRepo;
let programmes: FakeProgrammeRepo;
let audit: CapturingAudit;
let deptId: string;

beforeEach(async () => {
  faculties = new FakeFacultyRepo();
  departments = new FakeDepartmentRepo();
  subDepartments = new FakeSubDepartmentRepo();
  programmes = new FakeProgrammeRepo();
  faculties.departments = departments;
  departments.programmes = programmes;
  departments.subDepartments = subDepartments;
  subDepartments.programmes = programmes;
  audit = new CapturingAudit();
  const fac = await faculties.create({ name: "Sci", code: "SCI" });
  const dept = await departments.create({
    name: "CS",
    code: "CS",
    facultyId: fac.id,
  });
  deptId = dept.id;
});

describe("CreateSubDepartment", () => {
  it("creates under a live department and audits", async () => {
    const uc = new CreateSubDepartment(subDepartments, departments, audit);
    const sd = await uc.execute(
      { name: "Software Eng", code: "SWE", departmentId: deptId },
      admin,
    );
    expect(sd.code).toBe("SWE");
    expect(sd.departmentId).toBe(deptId);
    expect(audit.entries.at(-1)).toMatchObject({
      action: "CREATE",
      entity: "SubDepartment",
    });
  });

  it("rejects empty fields, a missing parent, and a duplicate live code", async () => {
    const uc = new CreateSubDepartment(subDepartments, departments, audit);
    await expect(
      uc.execute({ name: "", code: "X", departmentId: deptId }, admin),
    ).rejects.toThrow();
    await expect(
      uc.execute({ name: "X", code: "X", departmentId: "nope" }, admin),
    ).rejects.toBeInstanceOf(StructureError);
    await uc.execute({ name: "A", code: "SWE", departmentId: deptId }, admin);
    await expect(
      uc.execute({ name: "B", code: "SWE", departmentId: deptId }, admin),
    ).rejects.toThrow(/already in use/);
  });

  it("is denied through the seam without structure.manage", async () => {
    await expect(
      authorize(
        new CreateSubDepartment(subDepartments, departments, audit),
        { name: "A", code: "A", departmentId: deptId },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("UpdateSubDepartment", () => {
  it("renames and rejects a clashing code", async () => {
    const create = new CreateSubDepartment(subDepartments, departments, audit);
    const a = await create.execute(
      { name: "A", code: "AAA", departmentId: deptId },
      admin,
    );
    await create.execute(
      { name: "B", code: "BBB", departmentId: deptId },
      admin,
    );
    const uc = new UpdateSubDepartment(subDepartments, audit);
    const renamed = await uc.execute(
      { id: a.id, patch: { name: "Alpha" } },
      admin,
    );
    expect(renamed.name).toBe("Alpha");
    await expect(
      uc.execute({ id: a.id, patch: { code: "BBB" } }, admin),
    ).rejects.toThrow(/already in use/);
  });
});

describe("DeleteSubDepartment", () => {
  it("refuses while it still has a live programme, then succeeds", async () => {
    const create = new CreateSubDepartment(subDepartments, departments, audit);
    const sd = await create.execute(
      { name: "A", code: "AAA", departmentId: deptId },
      admin,
    );
    await programmes.create({
      name: "P",
      code: "P1",
      departmentId: deptId,
      subDepartmentId: sd.id,
      durationLevels: 4,
      creditsRequired: 0,
    });
    const del = new DeleteSubDepartment(subDepartments, audit);
    await expect(del.execute({ id: sd.id }, admin)).rejects.toThrow(
      /still has/,
    );
    // Remove the programme, then deletion succeeds.
    const live = programmes.s.live();
    programmes.s.remove(live[0]!.id);
    await del.execute({ id: sd.id }, admin);
    expect(await subDepartments.findById(sd.id)).toBeNull();
  });
});

describe("Department delete guards sub-departments", () => {
  it("refuses to delete a department that still has a sub-department", async () => {
    await new CreateSubDepartment(subDepartments, departments, audit).execute(
      { name: "A", code: "AAA", departmentId: deptId },
      admin,
    );
    await expect(
      new DeleteDepartment(departments, audit).execute({ id: deptId }, admin),
    ).rejects.toThrow(/sub-departments/);
  });
});

describe("ListSubDepartments", () => {
  it("lists by department", async () => {
    await new CreateSubDepartment(subDepartments, departments, audit).execute(
      { name: "A", code: "AAA", departmentId: deptId },
      admin,
    );
    const list = await new ListSubDepartments(subDepartments).execute(
      { departmentId: deptId },
      admin,
    );
    expect(list).toHaveLength(1);
  });
});
