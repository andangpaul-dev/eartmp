import { describe, it, expect, beforeEach } from "vitest";
import {
  ListInstitutions,
  CreateInstitution,
  UpdateInstitutionById,
  DeleteInstitution,
  SetDefaultInstitution,
} from "../../src/application/use-cases/config/ManageInstitutions";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { InstitutionError } from "../../src/domain/errors/config";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { CapturingAudit } from "../auth/fakes";
import { InMemoryInstitutionRepository } from "./fakes";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "institution.manage",
  "settings.read",
]);
const viewer = SessionContext.create("v", "VIEWER", ["settings.read"]);

let repo: InMemoryInstitutionRepository;
let audit: CapturingAudit;
beforeEach(() => {
  repo = new InMemoryInstitutionRepository(null);
  audit = new CapturingAudit();
});

describe("Institution management", () => {
  it("creates institutions; the first is the default", async () => {
    const create = new CreateInstitution(repo, audit);
    const a = await create.execute({ name: "Alpha University" }, admin);
    expect(a.isDefault).toBe(true);
    const b = await create.execute({ name: "Beta Institute" }, admin);
    expect(b.isDefault).toBe(false);
    const list = await new ListInstitutions(repo).execute({}, admin);
    expect(list.map((i) => i.name).sort()).toEqual([
      "Alpha University",
      "Beta Institute",
    ]);
  });

  it("rejects an empty name and an invalid calendar type", async () => {
    const create = new CreateInstitution(repo, audit);
    await expect(create.execute({ name: "  " }, admin)).rejects.toBeInstanceOf(
      InstitutionError,
    );
    await expect(
      create.execute({ name: "X", calendarType: "WEEKLY" }, admin),
    ).rejects.toThrow(/calendar type/);
  });

  it("switches the default institution", async () => {
    const create = new CreateInstitution(repo, audit);
    const a = await create.execute({ name: "Alpha" }, admin);
    const b = await create.execute({ name: "Beta" }, admin);
    await new SetDefaultInstitution(repo, audit).execute({ id: b.id }, admin);
    expect((await repo.findById(a.id))!.isDefault).toBe(false);
    expect((await repo.findById(b.id))!.isDefault).toBe(true);
  });

  it("refuses to delete the default or one with faculties", async () => {
    const create = new CreateInstitution(repo, audit);
    const a = await create.execute({ name: "Alpha" }, admin);
    const b = await create.execute({ name: "Beta" }, admin);
    const del = new DeleteInstitution(repo, audit);
    await expect(del.execute({ id: a.id }, admin)).rejects.toThrow(/default/);
    repo.faculties = 2;
    await expect(del.execute({ id: b.id }, admin)).rejects.toThrow(
      /still has faculties/,
    );
    repo.faculties = 0;
    await del.execute({ id: b.id }, admin);
    expect(await repo.findById(b.id)).toBeNull();
  });

  it("renames via updateById but never flips isDefault", async () => {
    const a = await new CreateInstitution(repo, audit).execute(
      { name: "Alpha" },
      admin,
    );
    const updated = await new UpdateInstitutionById(repo, audit).execute(
      { id: a.id, patch: { name: "Alpha Renamed", isDefault: false } },
      admin,
    );
    expect(updated.name).toBe("Alpha Renamed");
    expect(updated.isDefault).toBe(true); // isDefault ignored by updateById
  });

  it("is denied without institution.manage", async () => {
    await expect(
      authorize(new CreateInstitution(repo, audit), { name: "X" }, viewer),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
