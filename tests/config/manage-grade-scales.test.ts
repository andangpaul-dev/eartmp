import { describe, it, expect, beforeEach } from "vitest";
import {
  CreateGradeScale,
  UpdateGradeScale,
  DeleteGradeScale,
  SetDefaultGradeScale,
  ListGradeScales,
} from "../../src/application/use-cases/config/ManageGradeScales";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { GradeScaleError } from "../../src/domain/value-objects/GradeScale";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { CapturingAudit } from "../auth/fakes";
import { FakeGradeScaleRepo } from "./grading-fakes";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "config.read",
  "config.manage",
]);
const viewer = SessionContext.create("v", "VIEWER", ["config.read"]);

const validBands = [
  { minMark: 0, maxMark: 49, grade: "F", gradePoint: 0, isPass: false },
  { minMark: 50, maxMark: 100, grade: "P", gradePoint: 4, isPass: true },
];
const gappedBands = [
  { minMark: 0, maxMark: 30, grade: "F", gradePoint: 0, isPass: false },
  { minMark: 50, maxMark: 100, grade: "P", gradePoint: 4, isPass: true },
];

let scales: FakeGradeScaleRepo;
let audit: CapturingAudit;
beforeEach(() => {
  scales = new FakeGradeScaleRepo();
  audit = new CapturingAudit();
});

describe("CreateGradeScale (write-side validation)", () => {
  it("creates a valid scale and audits", async () => {
    const created = await new CreateGradeScale(scales, audit).execute(
      { name: "Standard", bands: validBands },
      admin,
    );
    expect(created.name).toBe("Standard");
    expect(JSON.parse(created.bands)).toHaveLength(2);
    expect(audit.entries[0]).toMatchObject({
      action: "CREATE",
      entity: "GradeScale",
    });
  });

  it("REJECTS an invalid scale (gap) on save", async () => {
    await expect(
      new CreateGradeScale(scales, audit).execute(
        { name: "Bad", bands: gappedBands },
        admin,
      ),
    ).rejects.toBeInstanceOf(GradeScaleError);
    expect(scales.byId.size).toBe(0);
  });

  it("rejects a duplicate live name", async () => {
    const uc = new CreateGradeScale(scales, audit);
    await uc.execute({ name: "Standard", bands: validBands }, admin);
    await expect(
      uc.execute({ name: "Standard", bands: validBands }, admin),
    ).rejects.toThrow(/already exists/);
  });

  it("is denied without config.manage", async () => {
    await expect(
      authorize(
        new CreateGradeScale(scales, audit),
        { name: "X", bands: validBands },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("UpdateGradeScale", () => {
  it("re-validates bands on edit", async () => {
    const created = await new CreateGradeScale(scales, audit).execute(
      { name: "S", bands: validBands },
      admin,
    );
    const uc = new UpdateGradeScale(scales, audit);
    await expect(
      uc.execute({ id: created.id, bands: gappedBands }, admin),
    ).rejects.toBeInstanceOf(GradeScaleError);
    const ok = await uc.execute({ id: created.id, name: "Renamed" }, admin);
    expect(ok.name).toBe("Renamed");
  });
});

describe("SetDefaultGradeScale (single default)", () => {
  it("sets the target default and clears others", async () => {
    const create = new CreateGradeScale(scales, audit);
    const a = await create.execute({ name: "A", bands: validBands }, admin);
    const b = await create.execute({ name: "B", bands: validBands }, admin);
    const setDefault = new SetDefaultGradeScale(scales, audit);
    await setDefault.execute({ id: a.id }, admin);
    await setDefault.execute({ id: b.id }, admin);
    expect((await scales.findDefault())?.name).toBe("B");
  });
});

describe("DeleteGradeScale (guarded)", () => {
  it("rejects deleting the current default; allows a non-default", async () => {
    const create = new CreateGradeScale(scales, audit);
    const a = await create.execute({ name: "A", bands: validBands }, admin);
    const b = await create.execute({ name: "B", bands: validBands }, admin);
    await new SetDefaultGradeScale(scales, audit).execute({ id: a.id }, admin);
    await expect(
      new DeleteGradeScale(scales, audit).execute({ id: a.id }, admin),
    ).rejects.toThrow(/Cannot delete the default/);
    await new DeleteGradeScale(scales, audit).execute({ id: b.id }, admin);
    expect(
      (await new ListGradeScales(scales).execute({}, admin)).map((s) => s.name),
    ).toEqual(["A"]);
  });
});
