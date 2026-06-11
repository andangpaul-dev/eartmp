import { describe, it, expect } from "vitest";
import { validateTemplateLayout } from "../../src/domain/services/TranscriptTemplateValidation";

const goodLayout = {
  pageSize: "A4",
  blocks: [
    { type: "title", value: "T" },
    {
      type: "fieldGrid",
      fields: [{ label: "Name", bind: "student.fullName" }],
    },
    {
      type: "sessionLoop",
      bind: "sessions",
      block: {
        type: "courseTable",
        groupHeading: "{{session}}",
        columns: [{ header: "Code", bind: "code" }],
        footer: [{ label: "GPA", bind: "semesterGpa" }],
      },
    },
    { type: "summary", fields: [{ label: "CGPA", bind: "summary.cgpa" }] },
    { type: "qr", bind: "verification.qrPayload" },
  ],
};

describe("validateTemplateLayout", () => {
  it("accepts a well-formed layout (no errors)", () => {
    expect(validateTemplateLayout(goodLayout)).toEqual([]);
  });

  it("rejects a non-object / missing blocks", () => {
    expect(validateTemplateLayout(null)).toHaveLength(1);
    expect(validateTemplateLayout({})).toEqual([
      "Layout must have a 'blocks' array.",
    ]);
  });

  it("flags an unknown block type", () => {
    const errs = validateTemplateLayout({ blocks: [{ type: "wat" }] });
    expect(errs.join()).toMatch(/unknown type "wat"/);
  });

  it("catches an unresolved required bind via the dry run", () => {
    const errs = validateTemplateLayout({
      blocks: [
        { type: "fieldGrid", fields: [{ label: "X", bind: "student.nope" }] },
      ],
    });
    expect(errs.join()).toMatch(/Unresolved required bind/);
  });

  it("catches bad sessionLoop nesting via the dry run", () => {
    const errs = validateTemplateLayout({
      blocks: [{ type: "sessionLoop", block: { type: "text", value: "x" } }],
    });
    expect(errs.join()).toMatch(/courseTable/);
  });
});
