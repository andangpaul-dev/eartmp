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

/** Shared courseTable layout used by grade-cell tests */
const gradeTableLayout = {
  blocks: [
    {
      type: "sessionLoop",
      block: {
        type: "courseTable",
        groupHeading: "{{session}}",
        columns: [
          { header: "Code", bind: "code" },
          { header: "Grade", bind: "grade" },
        ],
        footer: [],
      },
    },
  ],
};

function makeSessionData(
  courses: ReportData["sessions"][0]["courses"],
  extra?: Partial<ReportData>,
): ReportData {
  return {
    institution: { name: "Inst" },
    student: { matricNumber: "M/1", fullName: "Ada" },
    sessions: [
      {
        session: "2025/2026",
        semester: "First",
        semesterGpa: 3.0,
        creditsAttempted: 3,
        creditsEarned: 3,
        courses,
      },
    ],
    summary: { cgpa: 3.0, totalCreditsEarned: 3, standing: "Pass" },
    signatures: [],
    verification: { transcriptNumber: "TR-1", qrPayload: "TR-1" },
    issuedAt: "2026-01-01",
    ...extra,
  };
}

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

describe("bindTemplate — grade cell rendering (Task 6.3)", () => {
  it("appends '*' to grade when afterReattempt is true", () => {
    const reportData = makeSessionData([
      {
        code: "CS201",
        title: "Data Structures",
        creditValue: 3,
        grade: "C",
        afterReattempt: true,
      },
    ]);
    const doc = bindTemplate(gradeTableLayout, reportData);
    const table = doc.blocks.find((b) => b.type === "courseTable")!;
    if (table.type !== "courseTable") throw new Error("Expected courseTable");
    const gradeCell = table.rows[0]?.[1];
    expect(gradeCell).toBe("C*");
  });

  it("renders grade cell as 'I' when marker is 'I' (overrides grade)", () => {
    const reportData = makeSessionData([
      {
        code: "CS301",
        title: "Algorithms",
        creditValue: 3,
        marker: "I",
      },
    ]);
    const doc = bindTemplate(gradeTableLayout, reportData);
    const table = doc.blocks.find((b) => b.type === "courseTable")!;
    if (table.type !== "courseTable") throw new Error("Expected courseTable");
    const gradeCell = table.rows[0]?.[1];
    expect(gradeCell).toBe("I");
  });

  it("appends ' (DQ)' when marker is 'DQ'", () => {
    const reportData = makeSessionData([
      {
        code: "CS401",
        title: "OS",
        creditValue: 3,
        grade: "F",
        marker: "DQ",
      },
    ]);
    const doc = bindTemplate(gradeTableLayout, reportData);
    const table = doc.blocks.find((b) => b.type === "courseTable")!;
    if (table.type !== "courseTable") throw new Error("Expected courseTable");
    const gradeCell = table.rows[0]?.[1];
    expect(gradeCell).toBe("F (DQ)");
  });

  it("emits legend text blocks for each legendNote with correct symbol prefix", () => {
    const reportData = makeSessionData(
      [
        {
          code: "CS201",
          title: "Calc",
          creditValue: 3,
          grade: "C",
          afterReattempt: true,
        },
      ],
      {
        legendNotes: ["Mark obtained after Resit/Retake", "Incomplete"],
      },
    );
    const layoutWithLegend = {
      blocks: [...gradeTableLayout.blocks, { type: "legendNotes" }],
    };
    const doc = bindTemplate(layoutWithLegend, reportData);
    const textBlocks = doc.blocks.filter(
      (b): b is Extract<(typeof doc.blocks)[0], { type: "text" }> =>
        b.type === "text",
    );
    const texts = textBlocks.map((b) => b.text);
    expect(
      texts.some((t) => t.includes("* Mark obtained after Resit/Retake")),
    ).toBe(true);
    expect(texts.some((t) => t.includes("I Incomplete"))).toBe(true);
  });

  it("regression: plain course (no afterReattempt/marker/legendNotes) renders grade unchanged", () => {
    const reportData = makeSessionData([
      {
        code: "CS101",
        title: "Intro",
        creditValue: 3,
        grade: "A",
        gradePoint: 4,
      },
    ]);
    const doc = bindTemplate(gradeTableLayout, reportData);
    const table = doc.blocks.find((b) => b.type === "courseTable")!;
    if (table.type !== "courseTable") throw new Error("Expected courseTable");
    expect(table.rows[0]?.[1]).toBe("A");
    // No extra text blocks should appear
    const textBlocks = doc.blocks.filter((b) => b.type === "text");
    expect(textBlocks).toHaveLength(0);
  });
});
