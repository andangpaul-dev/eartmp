/**
 * expandNumberRule — expand an institution transcript-number rule (AD12.4).
 * Tokens: `{year}` → the year; `{seq:000000}` → the sequence zero-padded to the
 * number of zeros; `{seq}` → the bare sequence. Pure + testable.
 */
export function expandNumberRule(
  rule: string,
  year: number,
  seq: number,
): string {
  return rule
    .replace(/\{year\}/g, String(year))
    .replace(/\{seq:(0+)\}/g, (_m, zeros: string) =>
      String(seq).padStart(zeros.length, "0"),
    )
    .replace(/\{seq\}/g, String(seq));
}
