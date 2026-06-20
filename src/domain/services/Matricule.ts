/**
 * Matricule template expansion (WS C). Pure — sibling of TranscriptNumber.
 * Tokens: {institutionCode} {faculty} {dept} {year} {year2} {seq}/{seq:0000} {check}.
 */
import { computeCheck, type CheckScheme } from "./MatriculeCheck";

export interface MatriculeTokens {
  institutionCode?: string;
  faculty?: string;
  dept?: string;
  year: number;
  seq: number;
  checkScheme: CheckScheme;
}

export function admissionYear(session: string): number {
  const m = session.match(/(\d{4})/);
  if (!m) throw new Error(`Cannot parse admission year from "${session}".`);
  return Number(m[1]);
}

export function expandMatricule(template: string, t: MatriculeTokens): string {
  const expanded = template
    .replace(/\{institutionCode\}/g, t.institutionCode ?? "")
    .replace(/\{faculty\}/g, t.faculty ?? "")
    .replace(/\{dept\}/g, t.dept ?? "")
    .replace(/\{year2\}/g, String(t.year % 100).padStart(2, "0"))
    .replace(/\{year\}/g, String(t.year))
    .replace(/\{seq:(0+)\}/g, (_m, z) => String(t.seq).padStart(z.length, "0"))
    .replace(/\{seq\}/g, String(t.seq));
  if (!expanded.includes("{check}")) return expanded;
  const body = expanded.replace(/\{check\}/g, "");
  const check = computeCheck(t.checkScheme, body);
  return expanded.replace(/\{check\}/g, check);
}
