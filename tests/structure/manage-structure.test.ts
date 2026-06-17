import { describe, it, expect, beforeEach } from "vitest";
import {
  CreateFaculty,
  DeleteFaculty,
  CreateDepartment,
  CreateProgramme,
  CreateLevel,
  ListFaculties,
  UpdateFaculty,
  UpdateProgramme,
  UpdateLevel,
} from "../../src/application/use-cases/structure/ManageStructure";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { StructureError } from "../../src/domain/errors/structure";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { CapturingAudit } from "../auth/fakes";
import {
  FakeFacultyRepo,
  FakeDepartmentRepo,
  FakeProgrammeRepo,
  FakeLevelRepo,
} from "./fakes";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "structure.read",
  "structure.manage",
]);
const viewer = SessionContext.create("v", "VIEWER", ["structure.read"]);

let faculties: FakeFacultyRepo;
let departments: FakeDepartmentRepo;
let programmes: FakeProgrammeRepo;
let levels: FakeLevelRepo;
let audit: CapturingAudit;

beforeEach(() => {
  faculties = new FakeFacultyRepo();
  departments = new FakeDepartmentRepo();
  programmes = new FakeProgrammeRepo();
  levels = new FakeLevelRepo();
  faculties.departments = departments;
  departments.programmes = programmes;
  programmes.levels = levels;
  audit = new CapturingAudit();
});

describe("CreateFaculty", () => {
  it("creates and audits; rejects empty + duplicate live code", async () => {
    const uc = new CreateFaculty(faculties, audit);
    const f = await uc.execute({ name: "Science", code: "SCI" }, admin);
    expect(f.code).toBe("SCI");
    expect(audit.entries[0]).toMatchObject({
      action: "CREATE",
      entity: "Faculty",
    });
    await expect(uc.execute({ name: "X", code: "" }, admin)).rejects.toThrow();
    await expect(
      uc.execute({ name: "Dup", code: "SCI" }, admin),
    ).rejects.toBeInstanceOf(StructureError);
  });

  it("allows reusing a code after soft-delete", async () => {
    const create = new CreateFaculty(faculties, audit);
    const f = await create.execute({ name: "Science", code: "SCI" }, admin);
    await new DeleteFaculty(faculties, audit).execute({ id: f.id }, admin);
    const again = await create.execute(
      { name: "Science 2", code: "SCI" },
      admin,
    );
    expect(again.id).not.toBe(f.id);
  });

  it("is denied without structure.manage", async () => {
    await expect(
      authorize(
        new CreateFaculty(faculties, audit),
        { name: "X", code: "Y" },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("hierarchy referential invariants", () => {
  it("department requires a live faculty", async () => {
    await expect(
      new CreateDepartment(departments, faculties, audit).execute(
        { name: "CS", code: "CS", facultyId: "missing" },
        admin,
      ),
    ).rejects.toThrow(/faculty does not exist/);
  });

  it("programme requires a live department; level requires a programme", async () => {
    const f = await new CreateFaculty(faculties, audit).execute(
      { name: "Sci", code: "SCI" },
      admin,
    );
    const d = await new CreateDepartment(departments, faculties, audit).execute(
      { name: "CS", code: "CS", facultyId: f.id },
      admin,
    );
    const p = await new CreateProgramme(programmes, departments, audit).execute(
      { name: "BSc", code: "BSC", departmentId: d.id },
      admin,
    );
    expect(p.durationLevels).toBe(4);
    await expect(
      new CreateLevel(levels, programmes, audit).execute(
        { name: "100", rank: 1, programmeId: "missing" },
        admin,
      ),
    ).rejects.toThrow(/programme does not exist/);
  });
});

describe("CreateLevel rank uniqueness", () => {
  it("rejects a duplicate rank within a programme", async () => {
    const f = await new CreateFaculty(faculties, audit).execute(
      { name: "Sci", code: "SCI" },
      admin,
    );
    const d = await new CreateDepartment(departments, faculties, audit).execute(
      { name: "CS", code: "CS", facultyId: f.id },
      admin,
    );
    const p = await new CreateProgramme(programmes, departments, audit).execute(
      { name: "BSc", code: "BSC", departmentId: d.id },
      admin,
    );
    const uc = new CreateLevel(levels, programmes, audit);
    await uc.execute({ name: "100", rank: 1, programmeId: p.id }, admin);
    await expect(
      uc.execute({ name: "100b", rank: 1, programmeId: p.id }, admin),
    ).rejects.toThrow(/rank 1 already exists/);
  });
});

describe("DeleteFaculty soft-delete guard", () => {
  it("blocks deleting a faculty with live departments", async () => {
    const f = await new CreateFaculty(faculties, audit).execute(
      { name: "Sci", code: "SCI" },
      admin,
    );
    await new CreateDepartment(departments, faculties, audit).execute(
      { name: "CS", code: "CS", facultyId: f.id },
      admin,
    );
    await expect(
      new DeleteFaculty(faculties, audit).execute({ id: f.id }, admin),
    ).rejects.toThrow(/still has departments/);
  });
});

describe("ListFaculties", () => {
  it("lists only live faculties", async () => {
    const create = new CreateFaculty(faculties, audit);
    const a = await create.execute({ name: "A", code: "A" }, admin);
    await create.execute({ name: "B", code: "B" }, admin);
    await new DeleteFaculty(faculties, audit).execute({ id: a.id }, admin);
    const list = await new ListFaculties(faculties).execute({}, admin);
    expect(list.map((f) => f.code)).toEqual(["B"]);
  });
});

describe("per-institution code uniqueness (Phase C)", () => {
  it("allows the same faculty code in different institutions, rejects within one", async () => {
    const uc = new CreateFaculty(faculties, audit);
    await uc.execute(
      { name: "Sci A", code: "SCI", institutionId: "inst-1" },
      admin,
    );
    // Same code, different institution — allowed.
    const b = await uc.execute(
      { name: "Sci B", code: "SCI", institutionId: "inst-2" },
      admin,
    );
    expect(b.institutionId).toBe("inst-2");
    // Same code, same institution — rejected.
    await expect(
      uc.execute({ name: "Dup", code: "SCI", institutionId: "inst-1" }, admin),
    ).rejects.toThrow(/already in use/);
  });
});

describe("tenant isolation (Phase D)", () => {
  const scoped = SessionContext.create(
    "u",
    "REGISTRAR",
    ["structure.read", "structure.manage"],
    "inst-1",
  );

  it("a scoped operator only lists their institution's faculties", async () => {
    const g = SessionContext.create("admin", "SUPER_ADMIN", [
      "structure.read",
      "structure.manage",
    ]);
    const create = new CreateFaculty(faculties, audit);
    await create.execute({ name: "A", code: "A", institutionId: "inst-1" }, g);
    await create.execute({ name: "B", code: "B", institutionId: "inst-2" }, g);
    const list = await new ListFaculties(faculties).execute({}, scoped);
    expect(list.map((f) => f.code)).toEqual(["A"]);
  });

  it("forces a scoped operator's create into their own institution", async () => {
    const created = await new CreateFaculty(faculties, audit).execute(
      // Tries to plant it in inst-2; scope forces inst-1.
      { name: "X", code: "X", institutionId: "inst-2" },
      scoped,
    );
    expect(created.institutionId).toBe("inst-1");
  });

  it("refuses to mutate another institution's row (FORBIDDEN)", async () => {
    const g = SessionContext.create("admin", "SUPER_ADMIN", [
      "structure.read",
      "structure.manage",
    ]);
    const other = await new CreateFaculty(faculties, audit).execute(
      { name: "Other", code: "OTH", institutionId: "inst-2" },
      g,
    );
    await expect(
      new UpdateFaculty(faculties, audit).execute(
        { id: other.id, patch: { name: "Hijack" } },
        scoped,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("institution scope inheritance (Phase A)", () => {
  it("departments, sub-departments and programmes inherit the faculty's institution", async () => {
    const f = await new CreateFaculty(faculties, audit).execute(
      { name: "Sci", code: "SCI", institutionId: "inst-1" },
      admin,
    );
    expect(f.institutionId).toBe("inst-1");
    const d = await new CreateDepartment(departments, faculties, audit).execute(
      { name: "CS", code: "CS", facultyId: f.id },
      admin,
    );
    expect(d.institutionId).toBe("inst-1");
    const p = await new CreateProgramme(programmes, departments, audit).execute(
      { name: "BSc", code: "BSC", departmentId: d.id },
      admin,
    );
    expect(p.institutionId).toBe("inst-1");
  });
});

describe("Update use-cases (management)", () => {
  it("renames a faculty and rejects a clashing code", async () => {
    const create = new CreateFaculty(faculties, audit);
    const a = await create.execute({ name: "A", code: "AAA" }, admin);
    await create.execute({ name: "B", code: "BBB" }, admin);
    const uc = new UpdateFaculty(faculties, audit);
    const renamed = await uc.execute(
      { id: a.id, patch: { name: "Alpha" } },
      admin,
    );
    expect(renamed.name).toBe("Alpha");
    await expect(
      uc.execute({ id: a.id, patch: { code: "BBB" } }, admin),
    ).rejects.toThrow(/already in use/);
  });

  it("assigns a per-level grade scale and can clear it", async () => {
    const f = await new CreateFaculty(faculties, audit).execute(
      { name: "Sci", code: "SCI" },
      admin,
    );
    const d = await new CreateDepartment(departments, faculties, audit).execute(
      { name: "CS", code: "CS", facultyId: f.id },
      admin,
    );
    const p = await new CreateProgramme(programmes, departments, audit).execute(
      { name: "BSc", code: "BSC", departmentId: d.id },
      admin,
    );
    const l = await new CreateLevel(levels, programmes, audit).execute(
      { name: "100", rank: 1, programmeId: p.id },
      admin,
    );
    const uc = new UpdateLevel(levels, audit);
    const withScale = await uc.execute(
      { id: l.id, patch: { gradeScaleId: "gs-100" } },
      admin,
    );
    expect(withScale.gradeScaleId).toBe("gs-100");
    const cleared = await uc.execute(
      { id: l.id, patch: { gradeScaleId: null } },
      admin,
    );
    expect(cleared.gradeScaleId).toBeUndefined();
  });

  it("moves a programme into a sub-department via update", async () => {
    const f = await new CreateFaculty(faculties, audit).execute(
      { name: "Sci", code: "SCI" },
      admin,
    );
    const d = await new CreateDepartment(departments, faculties, audit).execute(
      { name: "CS", code: "CS", facultyId: f.id },
      admin,
    );
    const p = await new CreateProgramme(programmes, departments, audit).execute(
      { name: "BSc", code: "BSC", departmentId: d.id },
      admin,
    );
    const moved = await new UpdateProgramme(programmes, audit).execute(
      { id: p.id, patch: { subDepartmentId: "sd-1" } },
      admin,
    );
    expect(moved.subDepartmentId).toBe("sd-1");
  });
});
