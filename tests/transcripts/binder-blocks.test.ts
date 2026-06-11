import { describe, it, expect } from "vitest";
import { bindTemplate } from "../../src/domain/services/TranscriptBinder";
import type { ReportData } from "../../src/domain/services/TranscriptReportData";

const data: ReportData = {
  institution: { name: "Inst" },
  student: { matricNumber: "M/1", fullName: "Ada" },
  sessions: [],
  summary: { cgpa: 3, totalCreditsEarned: 0, standing: "Pass" },
  remarks: "Graduated with honours",
  signatures: [{ role: "Registrar", name: "Dr X", imagePath: "/sig.png" }],
  verification: { transcriptNumber: "TR-1", qrPayload: "TR-1" },
  issuedAt: "2026-01-01",
};

describe("bindTemplate — additional blocks", () => {
  it("binds title, text(value), remarks, signatureRow, qr(caption)", () => {
    const doc = bindTemplate(
      {
        blocks: [
          { type: "title", value: "TRANSCRIPT" },
          { type: "text", value: "Static line" },
          { type: "remarks", bind: "remarks" },
          { type: "signatureRow" },
          {
            type: "qr",
            bind: "verification.qrPayload",
            caption: "verification.transcriptNumber",
          },
        ],
      },
      data,
    );
    expect(doc.blocks[0]).toEqual({ type: "title", text: "TRANSCRIPT" });
    expect(doc.blocks[1]).toEqual({ type: "text", text: "Static line" });
    expect(doc.blocks[2]).toEqual({
      type: "remarks",
      text: "Graduated with honours",
    });
    expect(doc.blocks[3]).toMatchObject({
      type: "signatureRow",
      items: [{ role: "Registrar", name: "Dr X", image: "/sig.png" }],
    });
    expect(doc.blocks[4]).toMatchObject({
      type: "qr",
      payload: "TR-1",
      caption: "TR-1",
    });
  });

  it("rejects a standalone courseTable (must be inside a sessionLoop)", () => {
    expect(() =>
      bindTemplate({ blocks: [{ type: "courseTable", columns: [] }] }, data),
    ).toThrow(/sessionLoop/);
  });

  it("rejects a sessionLoop whose child is not a courseTable", () => {
    expect(() =>
      bindTemplate(
        {
          blocks: [
            { type: "sessionLoop", block: { type: "text", value: "x" } },
          ],
        },
        data,
      ),
    ).toThrow(/must be a courseTable/);
  });
});
