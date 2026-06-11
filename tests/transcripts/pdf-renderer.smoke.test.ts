/**
 * PdfMakeRenderer smoke test — produces REAL PDF bytes (no DB). Confirms the
 * PDFMake printer + bundled fonts + QR embedding work end to end.
 */
import { describe, it, expect } from "vitest";
import { PdfMakeRenderer } from "../../src/infrastructure/reporting/pdf/PdfMakeRenderer";
import type { ResolvedDoc } from "../../src/domain/services/TranscriptReportData";

const doc: ResolvedDoc = {
  pageSize: "A4",
  blocks: [
    { type: "title", text: "ACADEMIC TRANSCRIPT" },
    {
      type: "fieldGrid",
      columns: 2,
      fields: [{ label: "Name", value: "Ada" }],
    },
    { type: "qr", payload: "TR-1", caption: "TR-1" },
  ],
};

describe("PdfMakeRenderer (smoke)", () => {
  it("renders a non-empty PDF starting with %PDF", async () => {
    const bytes = await new PdfMakeRenderer().render(doc);
    expect(bytes.length).toBeGreaterThan(500);
    expect(
      String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!),
    ).toBe("%PDF");
  }, 30000);

  it("renders with a watermark without error", async () => {
    const bytes = await new PdfMakeRenderer().render(doc, {
      watermark: "DRAFT — NOT VALID",
    });
    expect(bytes.length).toBeGreaterThan(500);
  }, 30000);
});
