import { describe, it, expect } from "vitest";
import { buildCsvTemplateText } from "../../src/presentation/screens/import/csvTemplate";
describe("csv template", () => {
  it("builds a header-only CSV", () => {
    expect(
      buildCsvTemplateText([
        "Course code",
        "Course title",
        "Credit Value",
        "Course type",
      ]),
    ).toBe("Course code,Course title,Credit Value,Course type\n");
  });
  it("quotes a header containing a comma", () => {
    expect(buildCsvTemplateText(["a,b", "c"])).toBe('"a,b",c\n');
  });
});
