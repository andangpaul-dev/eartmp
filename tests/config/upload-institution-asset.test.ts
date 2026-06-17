import { describe, it, expect, beforeEach } from "vitest";
import { UploadInstitutionAsset } from "../../src/application/use-cases/config/UploadInstitutionAsset";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { ValidationError } from "../../src/domain/errors/validation";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { CapturingAudit } from "../auth/fakes";
import type { Institution } from "../../src/domain/entities/institution";
import type { InstitutionRepository } from "../../src/domain/repositories/config";
import type {
  AssetStorePort,
  BrandingAssetKind,
} from "../../src/application/ports/AssetStorePort";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "institution.manage",
]);

let inst: Institution;
let institutions: InstitutionRepository;
let saved: { id: string; kind: BrandingAssetKind; bytes: number } | null;
let assets: AssetStorePort;
let audit: CapturingAudit;

beforeEach(() => {
  inst = { id: "inst-1", name: "Uni", calendarType: "SEMESTER" };
  institutions = {
    async findById(id: string) {
      return id === inst.id ? inst : null;
    },
    async updateById(_id: string, patch: Partial<Institution>) {
      inst = { ...inst, ...patch };
      return inst;
    },
  } as unknown as InstitutionRepository;
  saved = null;
  assets = {
    async save(institutionId, kind, bytes) {
      saved = { id: institutionId, kind, bytes: bytes.length };
      return `/branding/${institutionId}/${kind}.png`;
    },
  };
  audit = new CapturingAudit();
});

describe("UploadInstitutionAsset", () => {
  it("stores the image and records its path on the institution", async () => {
    const uc = new UploadInstitutionAsset(institutions, assets, audit);
    const updated = await uc.execute(
      { institutionId: "inst-1", kind: "logo", base64: "AQID", ext: "png" },
      admin,
    );
    expect(saved).toEqual({ id: "inst-1", kind: "logo", bytes: 3 });
    expect(updated.logoPath).toBe("/branding/inst-1/logo.png");
    expect(audit.entries.at(-1)).toMatchObject({
      action: "UPDATE",
      entity: "Institution",
    });
  });

  it("maps each kind to its institution field", async () => {
    const uc = new UploadInstitutionAsset(institutions, assets, audit);
    await uc.execute(
      { institutionId: "inst-1", kind: "seal", base64: "AA==" },
      admin,
    );
    expect((await institutions.findById("inst-1"))!.sealPath).toContain(
      "seal.png",
    );
    await uc.execute(
      { institutionId: "inst-1", kind: "registrarSign", base64: "AA==" },
      admin,
    );
    expect(
      (await institutions.findById("inst-1"))!.registrarSignPath,
    ).toContain("registrarSign.png");
  });

  it("rejects an unknown kind and a missing institution", async () => {
    const uc = new UploadInstitutionAsset(institutions, assets, audit);
    await expect(
      uc.execute(
        { institutionId: "inst-1", kind: "banner" as never, base64: "AA==" },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      uc.execute(
        { institutionId: "nope", kind: "logo", base64: "AA==" },
        admin,
      ),
    ).rejects.toThrow(/not found/);
  });

  it("a scoped operator may not brand another institution", async () => {
    const scoped = SessionContext.create(
      "u",
      "REGISTRAR",
      ["institution.manage"],
      "other-inst",
    );
    const uc = new UploadInstitutionAsset(institutions, assets, audit);
    await expect(
      uc.execute(
        { institutionId: "inst-1", kind: "logo", base64: "AA==" },
        scoped,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("is denied without institution.manage", async () => {
    const viewer = SessionContext.create("v", "VIEWER", ["settings.read"]);
    await expect(
      authorize(
        new UploadInstitutionAsset(institutions, assets, audit),
        { institutionId: "inst-1", kind: "logo", base64: "AA==" },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
