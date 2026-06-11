/**
 * SpreadsheetReaderPort — turns spreadsheet bytes into raw rows. Keeps the
 * import use-case free of SheetJS (testable headlessly); the SheetJS adapter
 * lives in infrastructure and is the only place that parses untrusted files.
 */
export type RawRow = Record<string, string | number>;

export interface SpreadsheetReaderPort {
  /** Parse the first sheet of an .xlsx/.csv into header-keyed rows. */
  read(bytes: Uint8Array): RawRow[];
}
