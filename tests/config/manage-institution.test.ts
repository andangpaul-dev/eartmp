import { describe, it, expect } from "vitest";
import {
  GetInstitution,
  UpdateInstitution,
} from "../../src/application/use-cases/config/ManageInstitution";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { InstitutionError } from "../../src/domain/errors/config";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { CapturingAudit } from "../auth/fakes";
import { InMemoryInstitutionRepository, sampleInstitution } from "./fakes";

const admin = SessionContext.create("u1", "ADMIN", [
  "settings.read",
  "institution.manage",
]);
const viewer = SessionContext.create("u2", "VIEWER", ["settings.read"]);

describe("GetInstitution", () => {
  it("returns the provisioned institution", async () => {
    const uc = new GetInstitution(
      new InMemoryInstitutionRepository(sampleInstitution),
    );
    expect((await uc.execute({}, admin)).name).toBe("Example University");
  });

  it("throws when not provisioned", async () => {
    const uc = new GetInstitution(new InMemoryInstitutionRepository(null));
    await expect(uc.execute({}, admin)).rejects.toBeInstanceOf(
      InstitutionError,
    );
  });
});

describe("UpdateInstitution", () => {
  function build() {
    const repo = new InMemoryInstitutionRepository(sampleInstitution);
    const audit = new CapturingAudit();
    const uc = new UpdateInstitution(repo, audit);
    return { uc, repo, audit };
  }

  it("applies a patch and audits old→new", async () => {
    const { uc, audit } = build();
    const updated = await uc.execute(
      { patch: { motto: "Knowledge is power", calendarType: "TRIMESTER" } },
      admin,
    );
    expect(updated.motto).toBe("Knowledge is power");
    expect(updated.calendarType).toBe("TRIMESTER");
    expect(audit.entries[0]).toMatchObject({
      action: "UPDATE",
      entity: "Institution",
    });
    expect(audit.entries[0]!.newValue).toMatchObject({
      motto: "Knowledge is power",
    });
  });

  it("rejects an invalid calendarType", async () => {
    const { uc } = build();
    await expect(
      uc.execute({ patch: { calendarType: "WEEKLY" as never } }, admin),
    ).rejects.toBeInstanceOf(InstitutionError);
  });

  it("is denied through the seam without institution.manage", async () => {
    const { uc } = build();
    await expect(
      authorize(uc, { patch: { name: "X" } }, viewer),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
