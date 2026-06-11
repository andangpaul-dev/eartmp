/**
 * ExportTranscript — render a transcript to bytes from its FROZEN snapshot
 * (Phase 13, AD13.2), gated by status and audited. Official export requires
 * APPROVED/LOCKED (`TranscriptRules.canExport`); a `preview` of a DRAFT is
 * allowed but watermarked (AD13.3). Format-agnostic: takes a DocumentRendererPort
 * (PDF now, DOCX in P14).
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { TranscriptError } from "../../../domain/errors/transcript";
import {
  TranscriptRules,
  type TranscriptStatus,
} from "../../../domain/entities";
import type { ResolvedDoc } from "../../../domain/services/TranscriptReportData";
import type { TranscriptStore } from "../../../domain/repositories/transcripts";
import type { AuditLogPort } from "../../../domain/repositories";
import type {
  DocumentRendererPort,
  RenderOptions,
} from "../../ports/DocumentRendererPort";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

export interface ExportTranscriptInput {
  transcriptId: string;
  preview?: boolean;
}
export interface ExportResult {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}

export class ExportTranscript implements AuthorizedUseCase<
  ExportTranscriptInput,
  ExportResult
> {
  readonly name = "ExportTranscript";
  readonly requiredPermissions = ["transcripts.read"];

  constructor(
    private readonly transcripts: TranscriptStore,
    private readonly renderer: DocumentRendererPort,
    private readonly audit: AuditLogPort,
    private readonly contentType = "application/pdf",
    private readonly extension = "pdf",
  ) {}

  async execute(
    input: ExportTranscriptInput,
    session: SessionContext,
  ): Promise<ExportResult> {
    const t = await this.transcripts.findById(input.transcriptId);
    if (!t) throw new TranscriptError("Transcript not found.");

    const canExport = TranscriptRules.canExport(t.status as TranscriptStatus);
    if (!canExport && !input.preview) {
      throw new TranscriptError(
        `Transcript is "${t.status}" — approve it before exporting (or request a preview).`,
      );
    }

    let resolvedDoc: ResolvedDoc;
    try {
      resolvedDoc = (JSON.parse(t.snapshot) as { resolvedDoc: ResolvedDoc })
        .resolvedDoc;
      if (!resolvedDoc?.blocks) throw new Error("no resolvedDoc");
    } catch {
      throw new TranscriptError("Transcript snapshot is corrupt.");
    }

    const opts: RenderOptions = canExport
      ? {}
      : { watermark: "DRAFT — NOT VALID" };
    const bytes = await this.renderer.render(resolvedDoc, opts);

    await this.audit.record({
      userId: session.actorId,
      action: "EXPORT",
      entity: "Transcript",
      recordId: t.id,
      newValue: { format: this.extension, preview: !canExport },
    });

    return {
      bytes,
      filename: `${t.transcriptNumber}.${this.extension}`,
      contentType: this.contentType,
    };
  }
}
