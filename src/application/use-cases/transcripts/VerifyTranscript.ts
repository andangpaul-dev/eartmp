/**
 * VerifyTranscript / ApproveTranscript (Phase 12).
 *
 * VerifyTranscript recomputes nothing live — it verifies the stored snapshot's
 * signature with the institution public key (ADR-009 / F-14). A tampered
 * snapshot fails. ApproveTranscript moves a DRAFT to APPROVED (status workflow,
 * TranscriptRules); only APPROVED/LOCKED transcripts may be exported (P13).
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { TranscriptError } from "../../../domain/errors/transcript";
import {
  TranscriptRules,
  type TranscriptStatus,
} from "../../../domain/entities";
import type {
  TranscriptStore,
  StoredTranscript,
} from "../../../domain/repositories/transcripts";
import type { AuditLogPort } from "../../../domain/repositories";
import type { SignaturePort } from "../../ports/SignaturePort";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

export interface VerifyTranscriptInput {
  transcriptId: string;
}
export interface VerifyResult {
  valid: boolean;
  transcriptNumber: string;
}

export class VerifyTranscript implements AuthorizedUseCase<
  VerifyTranscriptInput,
  VerifyResult
> {
  readonly name = "VerifyTranscript";
  readonly requiredPermissions = ["transcripts.read"];

  constructor(
    private readonly transcripts: TranscriptStore,
    private readonly signer: SignaturePort,
  ) {}

  async execute(
    input: VerifyTranscriptInput,
    _session: SessionContext,
  ): Promise<VerifyResult> {
    const t = await this.transcripts.findById(input.transcriptId);
    if (!t) throw new TranscriptError("Transcript not found.");
    let signature = "";
    try {
      signature = (JSON.parse(t.verificationHash) as { signature: string })
        .signature;
    } catch {
      return { valid: false, transcriptNumber: t.transcriptNumber };
    }
    return {
      valid: this.signer.verify(t.snapshot, signature),
      transcriptNumber: t.transcriptNumber,
    };
  }
}

export interface ApproveTranscriptInput {
  transcriptId: string;
}
export class ApproveTranscript implements AuthorizedUseCase<
  ApproveTranscriptInput,
  StoredTranscript
> {
  readonly name = "ApproveTranscript";
  readonly requiredPermissions = ["transcripts.approve"];

  constructor(
    private readonly transcripts: TranscriptStore,
    private readonly audit: AuditLogPort,
  ) {}

  async execute(input: ApproveTranscriptInput, session: SessionContext) {
    const t = await this.transcripts.findById(input.transcriptId);
    if (!t) throw new TranscriptError("Transcript not found.");
    if (!TranscriptRules.isEditable(t.status as TranscriptStatus)) {
      throw new TranscriptError(
        `Transcript is "${t.status}" and cannot be approved.`,
      );
    }
    const updated = await this.transcripts.updateStatus(
      input.transcriptId,
      "APPROVED",
    );
    await this.audit.record({
      userId: session.actorId,
      action: "APPROVE",
      entity: "Transcript",
      recordId: input.transcriptId,
      oldValue: { status: t.status },
      newValue: { status: "APPROVED" },
    });
    return updated;
  }
}
