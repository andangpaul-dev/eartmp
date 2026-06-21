export interface ComponentRow {
  key: string;
  label: string;
  weight: number;
  maxScore: number;
}

export function weightTotal(rows: ComponentRow[]): number {
  return rows.reduce((s, c) => s + c.weight, 0);
}

export function validateComponents(rows: ComponentRow[]): string[] {
  const errs: string[] = [];
  if (rows.length === 0) return ["Add at least one component."];
  const keys = new Set<string>();
  rows.forEach((c, i) => {
    if (c.key.trim() === "") errs.push(`Component ${i + 1}: key is required.`);
    else if (keys.has(c.key)) errs.push(`Duplicate component key "${c.key}".`);
    else keys.add(c.key);
    if (!(c.weight >= 0 && c.weight <= 100))
      errs.push(`Component ${i + 1}: weight must be 0–100.`);
    if (!(c.maxScore > 0))
      errs.push(`Component ${i + 1}: max score must be > 0.`);
  });
  if (Math.abs(weightTotal(rows) - 100) > 1e-6)
    errs.push(`Weights must total 100 (currently ${weightTotal(rows)}).`);
  return errs;
}
