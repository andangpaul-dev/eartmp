/**
 * DocxRenderer — DocumentRendererPort over the `docx` library (Phase 14). Maps
 * the same format-agnostic ResolvedDoc to an editable Word document, returning
 * `.docx` bytes. The only place that imports `docx`/`qrcode` for Word output.
 * PDF stays canonical; DOCX is the editable copy (content-faithful, not pixel —
 * AD14.2). DRAFT renders a banner (docx has no simple watermark — AD14.3).
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  ImageRun,
  AlignmentType,
  WidthType,
} from "docx";
import QRCode from "qrcode";
import type {
  DocumentRendererPort,
  RenderOptions,
} from "../../../application/ports/DocumentRendererPort";
import type {
  ResolvedDoc,
  ResolvedBlock,
} from "../../../domain/services/TranscriptReportData";

type Child = Paragraph | Table;

function labelValue(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true }),
      new TextRun({ text: value }),
    ],
  });
}

function blockToChildren(block: ResolvedBlock, qr?: Buffer): Child[] {
  switch (block.type) {
    case "title":
      return [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: block.text, bold: true, size: 32 })],
        }),
      ];
    case "text":
      return [new Paragraph({ text: block.text })];
    case "fieldGrid":
      return block.fields.map((f) => labelValue(f.label, f.value));
    case "summary":
      return block.fields.map((f) => labelValue(f.label, f.value));
    case "remarks":
      return [
        new Paragraph({
          children: [
            new TextRun({ text: `Remarks: ${block.text}`, italics: true }),
          ],
        }),
      ];
    case "courseTable":
      return [
        new Paragraph({
          children: [new TextRun({ text: block.heading, bold: true })],
          spacing: { before: 160 },
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: block.columns.map(
                (c) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [new TextRun({ text: c.header, bold: true })],
                      }),
                    ],
                  }),
              ),
            }),
            ...block.rows.map(
              (r) =>
                new TableRow({
                  children: r.map(
                    (cell) =>
                      new TableCell({ children: [new Paragraph(cell)] }),
                  ),
                }),
            ),
          ],
        }),
        ...block.footer.map(
          (f) =>
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: `${f.label}: ${f.value}` })],
            }),
        ),
      ];
    case "signatureRow":
      return block.items.flatMap((it) => [
        new Paragraph({
          spacing: { before: 240 },
          children: [new TextRun({ text: "______________________" })],
        }),
        new Paragraph({ text: it.name }),
        new Paragraph({
          children: [new TextRun({ text: it.role, italics: true })],
        }),
      ]);
    case "qr":
      return qr
        ? [
            new Paragraph({
              spacing: { before: 160 },
              children: [
                new ImageRun({
                  data: qr,
                  transformation: { width: 90, height: 90 },
                }),
              ],
            }),
            ...(block.caption
              ? [
                  new Paragraph({
                    children: [new TextRun({ text: block.caption, size: 16 })],
                  }),
                ]
              : []),
          ]
        : [new Paragraph({ text: `Verify: ${block.payload}` })];
  }
}

export class DocxRenderer implements DocumentRendererPort {
  async render(
    doc: ResolvedDoc,
    opts: RenderOptions = {},
  ): Promise<Uint8Array> {
    const qrBlock = doc.blocks.find((b) => b.type === "qr");
    const qr =
      qrBlock && qrBlock.type === "qr"
        ? await QRCode.toBuffer(qrBlock.payload)
        : undefined;

    const children: Child[] = [];
    if (opts.watermark) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: opts.watermark,
              bold: true,
              color: "FF0000",
              size: 28,
            }),
          ],
        }),
      );
    }
    for (const block of doc.blocks)
      children.push(...blockToChildren(block, qr));

    const document = new Document({ sections: [{ children }] });
    const buffer = await Packer.toBuffer(document);
    return new Uint8Array(buffer);
  }
}
