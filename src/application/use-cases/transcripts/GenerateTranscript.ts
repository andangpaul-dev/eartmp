/**
 * GenerateTranscript — build → bind → snapshot → sign → number → persist
 * (Phase 12). Assigns a transcript number, assembles the ReportData, binds it to
 * the template into a ResolvedDoc, freezes a snapshot of BOTH (ADR-006 amend),
 * signs the snapshot (ADR-009), and persists a DRAFT Transcript. Gated +
 * audited. No rendering — that's Phase 13/14.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { TranscriptError } from "../../../domain/errors/transcript";
import { UniqueConstraintError } from "../../../domain/errors/persistence";
import { bindTemplate } from "../../../domain/services/TranscriptBinder";
import type {
  TranscriptStore,
  TranscriptTemplateRepository,
  StoredTranscript,
} from "../../../domain/repositories/transcripts";
import type { InstitutionRepository } from "../../../domain/repositories/config";
import type { AuditLogPort } from "../../../domain/repositories";
import type { ClockPort } from "../../ports/ClockPort";
import type { SignaturePort } from "../../ports/SignaturePort";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";
import type { ReportDataAssembler } from "./BuildReportData";

const DEFAULT_NUMBER_RULE = "TR-{year}-{seq:000000}";

// Two operators generating at once can derive the same sequence; the DB's
// UNIQUE(transcriptNumber) rejects the loser. Re-derive and retry a bounded
// number of times before giving up.
const MAX_NUMBER_ATTEMPTS = 5;

export interface GenerateTranscriptInput {
  studentId: string;
  type?: string;
  templateId?: string;
}

export class GenerateTranscript implements AuthorizedUseCase<
  GenerateTranscriptInput,
  StoredTranscript
> {
  readonly name = "GenerateTranscript";
  readonly requiredPermissions = ["transcripts.generate"];

  constructor(
    private readonly transcripts: TranscriptStore,
    private readonly templates: TranscriptTemplateRepository,
    private readonly institutions: InstitutionRepository,
    private readonly builder: ReportDataAssembler,
    private readonly signer: SignaturePort,
    private readonly clock: ClockPort,
    private readonly audit: AuditLogPort,
  ) {}

  async execute(
    input: GenerateTranscriptInput,
    session: SessionContext,
  ): Promise<StoredTranscript> {
    const institution = await this.institutions.get();
    if (!institution)
      throw new TranscriptError("Institution is not provisioned.");

    const template = input.templateId
      ? await this.templates.findById(input.templateId)
      : await this.templates.findDefault();
    if (!template)
      throw new TranscriptError("No transcript template configured.");

    let layout: unknown;
    try {
      layout = JSON.parse(template.layout);
    } catch {
      throw new TranscriptError(
        `Template "${template.name}" has corrupt layout JSON.`,
      );
    }

    const rule = institution.transcriptNumberRule ?? DEFAULT_NUMBER_RULE;

    // The number is embedded in (and signed into) the snapshot, so a collision
    // means re-deriving the number AND re-signing — hence the whole build is
    // inside the retry loop.
    let created: StoredTranscript | undefined;
    let transcriptNumber = "";
    for (let attempt = 1; ; attempt++) {
      transcriptNumber = await this.transcripts.nextTranscriptNumber(rule);
      const issuedAt = this.clock.now().toISOString();

      const reportData = await this.builder.assemble(
        input.studentId,
        transcriptNumber,
        issuedAt,
      );
      const resolvedDoc = bindTemplate(layout, reportData);

      // Snapshot freezes data + resolved layout so re-issue is exact (ADR-006).
      const snapshot = JSON.stringify({
        reportData,
        resolvedDoc,
        templateName: template.name,
        templateVersion: template.version,
        issuedAt,
      });
      const sig = this.signer.sign(snapshot);
      const verificationHash = JSON.stringify({
        signature: sig.signature,
        keyId: sig.keyId,
      });

      try {
        created = await this.transcripts.create({
          transcriptNumber,
          studentId: input.studentId,
          templateId: template.id,
          type: input.type ?? "ACADEMIC_TRANSCRIPT",
          snapshot,
          verificationHash,
          status: "DRAFT",
        });
        break;
      } catch (e) {
        const racedNumber =
          e instanceof UniqueConstraintError &&
          (e.field === "transcriptNumber" || e.field === undefined);
        if (racedNumber && attempt < MAX_NUMBER_ATTEMPTS) continue;
        if (racedNumber) {
          throw new TranscriptError(
            "Could not allocate a unique transcript number; please retry.",
          );
        }
        throw e;
      }
    }

    await this.audit.record({
      userId: session.actorId,
      action: "GENERATE",
      entity: "Transcript",
      recordId: created.id,
      newValue: { transcriptNumber },
    });
    return created;
  }
}
