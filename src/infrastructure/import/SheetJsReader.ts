/**
 * SheetJsReader — SpreadsheetReaderPort implementation over SheetJS (`xlsx`).
 * The only place that parses untrusted spreadsheet bytes. Defensive: caps file
 * and row counts, reads the first sheet, and returns header-keyed rows
 * (security architecture §7 / AD10.6).
 */
import * as XLSX from "xlsx";
import type {
  SpreadsheetReaderPort,
  RawRow,
} from "../../application/ports/SpreadsheetReaderPort";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_ROWS = 200_000;

export class SheetJsReader implements SpreadsheetReaderPort {
  read(bytes: Uint8Array): RawRow[] {
    if (bytes.length > MAX_BYTES) {
      throw new Error("Spreadsheet is too large to import.");
    }
    const wb = XLSX.read(bytes, { type: "array" });
    const firstSheetName = wb.SheetNames[0];
    if (!firstSheetName) return [];
    const sheet = wb.Sheets[firstSheetName];
    if (!sheet) return [];
    const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { raw: true });
    if (rows.length > MAX_ROWS) {
      throw new Error(
        `Spreadsheet has too many rows (${rows.length} > ${MAX_ROWS}).`,
      );
    }
    return rows;
  }
}
