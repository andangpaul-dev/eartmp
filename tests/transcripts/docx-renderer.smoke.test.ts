/**
 * DocxRenderer smoke test — produces REAL .docx (zip/PK) bytes (no DB). Confirms
 * the docx library + QR embedding + DRAFT banner path work end to end, and that
 * ExportTranscript yields the docx filename/content-type with the DOCX renderer.
 */
import { describe, it, expect } from "vitest";
import { DocxRenderer } from "../../src/infrastructure/reporting/docx/DocxRenderer";
import { ExportTranscript } from "../../src/application/use-cases/transcripts/ExportTranscript";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { CapturingAudit } from "../auth/fakes";
import type { ResolvedDoc } from "../../src/domain/services/TranscriptReportData";
import type {
  TranscriptStore,
  StoredTranscript,
} from "../../src/domain/repositories/transcripts";

const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const doc: ResolvedDoc = {
  pageSize: "A4",
  blocks: [
    { type: "title", text: "ACADEMIC TRANSCRIPT" },
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
    { type: "signatureRow", items: [{ role: "Registrar", name: "Dr X" }] },
    { type: "qr", payload: "TR-1", caption: "TR-1" },
  ],
};

function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

describe("DocxRenderer (smoke)", () => {
  it("renders a non-empty .docx (PK zip)", async () => {
    const bytes = await new DocxRenderer().render(doc);
    expect(bytes.length).toBeGreaterThan(500);
    expect(isZip(bytes)).toBe(true);
  }, 30000);

  it("renders with a DRAFT banner without error", async () => {
    const bytes = await new DocxRenderer().render(doc, {
      watermark: "DRAFT — NOT VALID",
    });
    expect(isZip(bytes)).toBe(true);
  }, 30000);
});

describe("ExportTranscript with DocxRenderer", () => {
  it("produces a .docx filename and content-type", async () => {
    const t: StoredTranscript = {
      id: "t1",
      transcriptNumber: "TR-1",
      studentId: "s1",
      templateId: "tpl",
      type: "ACADEMIC_TRANSCRIPT",
      snapshot: JSON.stringify({ resolvedDoc: doc }),
      verificationHash: "{}",
      status: "APPROVED",
    };
    const store: TranscriptStore = {
      async findById() {
        return t;
      },
      async findByNumber() {
        return null;
      },
      async findByStudent() {
        return [];
      },
      async create() {
        return t;
      },
      async updateStatus() {
        return t;
      },
      async nextTranscriptNumber() {
        return "TR-1";
      },
      async listRecords() {
        return [];
      },
      async countIssuedByStudent() {
        return 0;
      },
    };
    const exporter = new ExportTranscript(
      store,
      new DocxRenderer(),
      new CapturingAudit(),
      DOCX_TYPE,
      "docx",
    );
    const out = await exporter.execute(
      { transcriptId: "t1" },
      SessionContext.create("a", "ADMIN", ["transcripts.read"]),
    );
    expect(out.filename).toBe("TR-1.docx");
    expect(out.contentType).toBe(DOCX_TYPE);
    expect(isZip(out.bytes)).toBe(true);
  });
});
