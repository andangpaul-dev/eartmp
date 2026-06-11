import { describe, it, expect } from "vitest";
import { bindTemplate } from "../../src/domain/services/TranscriptBinder";
import { TranscriptError } from "../../src/domain/errors/transcript";
import type { ReportData } from "../../src/domain/services/TranscriptReportData";

const data: ReportData = {
  institution: { name: "Example University" },
  student: { matricNumber: "M/1", fullName: "Ada" },
  sessions: [
    {
      session: "2024/2025",
      semester: "First",
      semesterGpa: 3.6,
      creditsAttempted: 5,
      creditsEarned: 5,
      courses: [
        {
          code: "CS101",
          title: "Intro",
          creditValue: 3,
          grade: "A",
          gradePoint: 4,
        },
      ],
    },
  ],
  summary: { cgpa: 3.6, totalCreditsEarned: 5, standing: "First Class" },
  signatures: [{ role: "Registrar", name: "Dr X" }],
  verification: { transcriptNumber: "TR-1", qrPayload: "TR-1" },
  issuedAt: "2026-01-01T00:00:00.000Z",
};

describe("bindTemplate", () => {
  it("resolves fields, summary, qr, and a sessionLoop course table", () => {
    const layout = {
      pageSize: "A4",
      blocks: [
        { type: "title", value: "ACADEMIC TRANSCRIPT" },
        {
          type: "fieldGrid",
          columns: 2,
          fields: [
            { label: "Name", bind: "student.fullName" },
            { label: "Matric", bind: "student.matricNumber" },
          ],
        },
        {
          type: "sessionLoop",
          bind: "sessions",
          block: {
            type: "courseTable",
            groupHeading: "{{session}} — {{semester}}",
            columns: [
              { header: "Code", bind: "code" },
              { header: "Grade", bind: "grade" },
            ],
            footer: [{ label: "GPA", bind: "semesterGpa" }],
          },
        },
        { type: "summary", fields: [{ label: "CGPA", bind: "summary.cgpa" }] },
        { type: "qr", bind: "verification.qrPayload" },
      ],
    };
    const doc = bindTemplate(layout, data);
    expect(doc.pageSize).toBe("A4");
    const grid = doc.blocks.find((b) => b.type === "fieldGrid")!;
    expect(grid).toMatchObject({
      fields: [
        { label: "Name", value: "Ada" },
        { label: "Matric", value: "M/1" },
      ],
    });
    const table = doc.blocks.find((b) => b.type === "courseTable")!;
    expect(table).toMatchObject({
      heading: "2024/2025 — First",
      rows: [["CS101", "A"]],
      footer: [{ label: "GPA", value: "3.6" }],
    });
    expect(doc.blocks.find((b) => b.type === "summary")).toMatchObject({
      fields: [{ label: "CGPA", value: "3.6" }],
    });
    expect(doc.blocks.find((b) => b.type === "qr")).toMatchObject({
      payload: "TR-1",
    });
  });

  it("fails on an unknown block type", () => {
    expect(() => bindTemplate({ blocks: [{ type: "wat" }] }, data)).toThrow(
      /Unknown template block/,
    );
  });

  it("fails on an unresolved required bind", () => {
    expect(() =>
      bindTemplate(
        {
          blocks: [
            {
              type: "fieldGrid",
              fields: [{ label: "X", bind: "student.nope" }],
            },
          ],
        },
        data,
      ),
    ).toThrow(TranscriptError);
  });

  it("leniently renders optional template interpolation (missing → empty)", () => {
    const doc = bindTemplate(
      { blocks: [{ type: "text", template: "Motto: {{institution.motto}}" }] },
      data,
    );
    expect(doc.blocks[0]).toMatchObject({ type: "text", text: "Motto: " });
  });
});
