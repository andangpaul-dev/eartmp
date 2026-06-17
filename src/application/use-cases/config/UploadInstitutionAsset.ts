/**
 * UploadInstitutionAsset — store an institution's branding image (logo / seal /
 * registrar signature) and record its path on the institution, so transcripts
 * for that institution render it. Gated institution.manage; a scoped operator
 * may only upload to their own institution. The image is sent base64-encoded.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { ValidationError } from "../../../domain/errors/validation";
import type { Institution } from "../../../domain/entities/institution";
import type { InstitutionRepository } from "../../../domain/repositories/config";
import type { AuditLogPort } from "../../../domain/repositories";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";
import { requireInScope } from "../../authorization/institutionScope";
import type {
  AssetStorePort,
  BrandingAssetKind,
} from "../../ports/AssetStorePort";

const KINDS: BrandingAssetKind[] = ["logo", "seal", "registrarSign"];
const FIELD: Record<BrandingAssetKind, keyof Institution> = {
  logo: "logoPath",
  seal: "sealPath",
  registrarSign: "registrarSignPath",
};

export interface UploadInstitutionAssetInput {
  institutionId: string;
  kind: BrandingAssetKind;
  base64: string;
  ext?: string;
}

export class UploadInstitutionAsset implements AuthorizedUseCase<
  UploadInstitutionAssetInput,
  Institution
> {
  readonly name = "UploadInstitutionAsset";
  readonly requiredPermissions = ["institution.manage"];

  constructor(
    private readonly institutions: InstitutionRepository,
    private readonly assets: AssetStorePort,
    private readonly audit: AuditLogPort,
  ) {}

  async execute(
    input: UploadInstitutionAssetInput,
    session: SessionContext,
  ): Promise<Institution> {
    if (!KINDS.includes(input.kind)) {
      throw new ValidationError(`Unknown asset kind "${input.kind}".`);
    }
    if (!input.base64) {
      throw new ValidationError("No image data provided.");
    }
    const inst = await this.institutions.findById(input.institutionId);
    if (!inst) throw new ValidationError("Institution not found.");
    // A scoped operator may only brand their own institution.
    requireInScope(inst.id, session);

    const bytes = Buffer.from(input.base64, "base64");
    const path = await this.assets.save(
      input.institutionId,
      input.kind,
      bytes,
      input.ext ?? "png",
    );
    const updated = await this.institutions.updateById(input.institutionId, {
      [FIELD[input.kind]]: path,
    });
    await this.audit.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "Institution",
      recordId: input.institutionId,
      newValue: { [FIELD[input.kind]]: "(uploaded)" },
    });
    return updated;
  }
}
