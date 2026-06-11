/**
 * buildPdfDocDefinition — PURE map from a ResolvedDoc to a PDFMake document
 * definition (Phase 13, AD13.1). No PDFMake import, no I/O — just plain objects,
 * so it is fully unit-testable without generating bytes. The QR image and the
 * watermark are passed in (the renderer pre-resolves them).
 */
import type {
  ResolvedDoc,
  ResolvedBlock,
} from "../../../domain/services/TranscriptReportData";

export interface PdfBuildOptions {
  watermark?: string;
  qrDataUrl?: string;
}

type Node = Record<string, unknown>;

function blockToContent(block: ResolvedBlock, opts: PdfBuildOptions): Node[] {
  switch (block.type) {
    case "title":
      return [{ text: block.text, style: "title", margin: [0, 0, 0, 8] }];
    case "text":
      return [{ text: block.text, margin: [0, 0, 0, 4] }];
    case "fieldGrid":
      return [
        {
          table: {
            widths: ["auto", "*"],
            body: block.fields.map((f) => [
              { text: `${f.label}:`, bold: true },
              { text: f.value },
            ]),
          },
          layout: "noBorders",
          margin: [0, 0, 0, 6],
        },
      ];
    case "courseTable":
      return [
        { text: block.heading, bold: true, margin: [0, 8, 0, 2] },
        {
          table: {
            headerRows: 1,
            widths: block.columns.map(() => "*"),
            body: [
              block.columns.map((c) => ({ text: c.header, bold: true })),
              ...block.rows.map((r) => r.map((cell) => ({ text: cell }))),
            ],
          },
          layout: "lightHorizontalLines",
        },
        ...block.footer.map((f) => ({
          text: `${f.label}: ${f.value}`,
          alignment: "right",
          margin: [0, 2, 0, 0],
        })),
      ];
    case "summary":
      return [
        {
          table: {
            widths: ["auto", "*"],
            body: block.fields.map((f) => [
              { text: `${f.label}:`, bold: true },
              { text: f.value },
            ]),
          },
          layout: "noBorders",
          margin: [0, 8, 0, 0],
        },
      ];
    case "remarks":
      return [
        { text: `Remarks: ${block.text}`, italics: true, margin: [0, 8, 0, 0] },
      ];
    case "signatureRow":
      return [
        {
          columns: block.items.map((it) => ({
            stack: [
              { text: "______________________", margin: [0, 16, 0, 0] },
              { text: it.name },
              { text: it.role, italics: true },
            ],
          })),
          margin: [0, 20, 0, 0],
        },
      ];
    case "qr":
      return opts.qrDataUrl
        ? [
            { image: opts.qrDataUrl, width: 80, margin: [0, 10, 0, 0] },
            ...(block.caption ? [{ text: block.caption, fontSize: 8 }] : []),
          ]
        : [
            {
              text: `Verify: ${block.payload}`,
              fontSize: 8,
              margin: [0, 10, 0, 0],
            },
          ];
  }
}

export function buildPdfDocDefinition(
  doc: ResolvedDoc,
  opts: PdfBuildOptions = {},
): Node {
  const content: Node[] = [];
  for (const block of doc.blocks) content.push(...blockToContent(block, opts));

  const def: Node = {
    pageSize: doc.pageSize || "A4",
    pageMargins: [40, 50, 40, 50],
    content,
    styles: { title: { fontSize: 16, bold: true, alignment: "center" } },
    defaultStyle: { font: "Roboto", fontSize: 10 },
  };
  if (opts.watermark) {
    def.watermark = { text: opts.watermark, opacity: 0.3, bold: true };
  }
  return def;
}
