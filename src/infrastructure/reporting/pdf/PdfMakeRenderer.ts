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

// The pdfmake printer + decoded fonts are expensive to build and identical for
// every render — memoize them at module scope (batch transcript generation
// reused this work on every document before).
interface PdfKitDoc {
  on(event: string, cb: (arg: never) => void): void;
  end(): void;
}
let printerSingleton: { createPdfKitDocument(def: unknown): PdfKitDoc };
function getPrinter(): { createPdfKitDocument(def: unknown): PdfKitDoc } {
  if (printerSingleton) return printerSingleton;
  const PdfPrinter = require("pdfmake");
  const vfs = require("pdfmake/build/vfs_fonts.js");
  const vfsData = vfs.pdfMake?.vfs ?? vfs.vfs ?? vfs;
  const font = (name: string): Buffer => {
    const b64 = vfsData[name];
    if (!b64) throw new Error(`pdfmake VFS missing font "${name}".`);
    return Buffer.from(b64, "base64");
  };
  const fonts = {
    Roboto: {
      normal: font("Roboto-Regular.ttf"),
      bold: font("Roboto-Medium.ttf"),
      italics: font("Roboto-Italic.ttf"),
      bolditalics: font("Roboto-MediumItalic.ttf"),
    },
  };
  printerSingleton = new PdfPrinter(fonts);
  return printerSingleton;
}

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

    const pdfDoc = getPrinter().createPdfKitDocument(def);

    return new Promise<Uint8Array>((resolve, reject) => {
      const chunks: Buffer[] = [];
      pdfDoc.on("data", (c: Buffer) => chunks.push(c));
      pdfDoc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
      pdfDoc.on("error", reject);
      pdfDoc.end();
    });
  }
}
