/**
 * PdfMakeRenderer — DocumentRendererPort over PDFMake (Phase 13). The only place
 * that touches the PDFMake printer + fonts. Generates the QR image, builds the
 * (pure) doc definition, and streams PDF bytes. Uses the bundled Roboto font so
 * output is deterministic across machines (AD13.5). DEV-ONLY (Node); the shell
 * uses the same port.
 */
import { createRequire } from "node:module";
import QRCode from "qrcode";
import type {
  DocumentRendererPort,
  RenderOptions,
} from "../../../application/ports/DocumentRendererPort";
import type { ResolvedDoc } from "../../../domain/services/TranscriptReportData";
import { buildPdfDocDefinition } from "./buildPdfDocDefinition";

const require = createRequire(import.meta.url);

export class PdfMakeRenderer implements DocumentRendererPort {
  async render(
    doc: ResolvedDoc,
    opts: RenderOptions = {},
  ): Promise<Uint8Array> {
    const qrBlock = doc.blocks.find((b) => b.type === "qr");
    const qrDataUrl =
      qrBlock && qrBlock.type === "qr"
        ? await QRCode.toDataURL(qrBlock.payload)
        : undefined;

    const def = buildPdfDocDefinition(doc, {
      ...(opts.watermark ? { watermark: opts.watermark } : {}),
      ...(qrDataUrl ? { qrDataUrl } : {}),
    });

    // pdfmake is CommonJS; load the server printer + bundled fonts.
    const PdfPrinter = require("pdfmake");
    const vfs = require("pdfmake/build/vfs_fonts.js");
    const vfsData = vfs.pdfMake?.vfs ?? vfs.vfs ?? vfs;
    const fonts = {
      Roboto: {
        normal: Buffer.from(vfsData["Roboto-Regular.ttf"], "base64"),
        bold: Buffer.from(vfsData["Roboto-Medium.ttf"], "base64"),
        italics: Buffer.from(vfsData["Roboto-Italic.ttf"], "base64"),
        bolditalics: Buffer.from(vfsData["Roboto-MediumItalic.ttf"], "base64"),
      },
    };
    const printer = new PdfPrinter(fonts);
    const pdfDoc = printer.createPdfKitDocument(def);

    return new Promise<Uint8Array>((resolve, reject) => {
      const chunks: Buffer[] = [];
      pdfDoc.on("data", (c: Buffer) => chunks.push(c));
      pdfDoc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
      pdfDoc.on("error", reject);
      pdfDoc.end();
    });
  }
}
