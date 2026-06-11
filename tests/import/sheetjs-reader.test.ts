/**
 * SheetJS reader parse test — round-trips an in-memory workbook (no files).
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { SheetJsReader } from "../../src/infrastructure/import/SheetJsReader";

function toXlsx(rows: Record<string, string | number>[]): Uint8Array {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
}

describe("SheetJsReader", () => {
  it("parses header-keyed rows from the first sheet", () => {
    const bytes = toXlsx([
      { matricNumber: "M/1", courseCode: "CS101", ca: 28, exam: 65 },
      { matricNumber: "M/2", courseCode: "CS101", ca: 30, exam: 70 },
    ]);
    const rows = new SheetJsReader().read(bytes);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      matricNumber: "M/1",
      courseCode: "CS101",
      ca: 28,
      exam: 65,
    });
  });

  it("returns an empty array for an empty workbook", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "Empty");
    const bytes = XLSX.write(wb, {
      type: "array",
      bookType: "xlsx",
    }) as Uint8Array;
    expect(new SheetJsReader().read(bytes)).toEqual([]);
  });
});
