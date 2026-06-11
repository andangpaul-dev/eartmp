import { describe, it, expect } from "vitest";
import { buildPdfDocDefinition } from "../../src/infrastructure/reporting/pdf/buildPdfDocDefinition";
import type { ResolvedDoc } from "../../src/domain/services/TranscriptReportData";

const doc: ResolvedDoc = {
  pageSize: "A4",
  blocks: [
    { type: "title", text: "TRANSCRIPT" },
    {
      type: "fieldGrid",
      columns: 2,
      fields: [{ label: "Name", value: "Ada" }],
    },
    {
      type: "courseTable",
      heading: "Sem 1",
      columns: [{ header: "Code" }, { header: "Grade" }],
      rows: [["CS101", "A"]],
      footer: [{ label: "GPA", value: "4" }],
    },
    { type: "summary", fields: [{ label: "CGPA", value: "4" }] },
    { type: "qr", payload: "TR-1" },
  ],
};

describe("buildPdfDocDefinition", () => {
  it("maps blocks to pdfmake nodes", () => {
    const def = buildPdfDocDefinition(doc);
    const content = def.content as Record<string, unknown>[];
    expect(content[0]).toMatchObject({ text: "TRANSCRIPT", style: "title" });
    // fieldGrid → a table
    expect(content.some((n) => "table" in n)).toBe(true);
    // course table header row present
    const tables = content.filter((n) => "table" in n);
    expect(JSON.stringify(tables)).toContain("CS101");
    expect(def.defaultStyle).toMatchObject({ font: "Roboto" });
  });

  it("embeds the QR image when a data URL is supplied; else falls back to text", () => {
    const withQr = buildPdfDocDefinition(doc, {
      qrDataUrl: "data:image/png;base64,AAA",
    });
    expect(JSON.stringify(withQr.content)).toContain("data:image/png");
    const noQr = buildPdfDocDefinition(doc);
    expect(JSON.stringify(noQr.content)).toContain("Verify: TR-1");
  });

  it("adds a watermark only when requested", () => {
    expect(buildPdfDocDefinition(doc).watermark).toBeUndefined();
    expect(
      buildPdfDocDefinition(doc, { watermark: "DRAFT — NOT VALID" }).watermark,
    ).toMatchObject({ text: "DRAFT — NOT VALID" });
  });
});
