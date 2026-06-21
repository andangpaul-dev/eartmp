export interface BandRow {
  minMark: number;
  maxMark: number;
  grade: string;
  gradePoint: number;
  isPass: boolean;
}
export function validateBands(rows: BandRow[]): string[] {
  const errs: string[] = [];
  if (rows.length === 0) return ["Add at least one band."];
  rows.forEach((b, i) => {
    if (b.grade.trim() === "") errs.push(`Band ${i + 1}: grade is required.`);
    if (!(b.minMark >= 0 && b.maxMark <= 100))
      errs.push(`Band ${i + 1}: marks must be within 0–100.`);
    if (b.minMark > b.maxMark)
      errs.push(`Band ${i + 1}: min mark exceeds max mark.`);
    if (b.gradePoint < 0) errs.push(`Band ${i + 1}: grade point must be ≥ 0.`);
  });
  const sorted = [...rows].sort((a, b) => a.minMark - b.minMark);
  if (sorted[0]!.minMark !== 0) errs.push("Bands must start at 0.");
  if (sorted[sorted.length - 1]!.maxMark !== 100)
    errs.push("Bands must cover up to 100.");
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!,
      cur = sorted[i]!;
    if (cur.minMark <= prev.maxMark)
      errs.push(`Bands overlap around ${cur.minMark}.`);
    else if (cur.minMark !== prev.maxMark + 1)
      errs.push(`Gap between bands at ${prev.maxMark + 1}.`);
  }
  return errs;
}
