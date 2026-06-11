/**
 * DocumentRendererPort — renders a resolved transcript document to bytes. PDF
 * (Phase 13) and DOCX (Phase 14) both implement this, so ExportTranscript is
 * format-agnostic. The use-cases depend on this interface, not on a rendering
 * library.
 */
import type { ResolvedDoc } from "../../domain/services/TranscriptReportData";

export interface RenderOptions {
  /** When set, stamps a watermark (e.g. "DRAFT — NOT VALID"). */
  watermark?: string;
}

export interface DocumentRendererPort {
  render(doc: ResolvedDoc, opts?: RenderOptions): Promise<Uint8Array>;
}
