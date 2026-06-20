/**
 * Result sitting + status value-objects. Sittings distinguish the normal exam
 * from the semester's resit; statuses classify a row for GPA/transcript. Stored
 * as strings on Result (Approach A); guarded here so the allowed set has one
 * source of truth.
 */
export const RESULT_SITTINGS = ["NORMAL", "RESIT"] as const;
export type ResultSitting = (typeof RESULT_SITTINGS)[number];

export const RESULT_STATUSES = [
  "GRADED",
  "DID",
  "DISQUALIFIED",
  "INCOMPLETE",
] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

export function assertSitting(v: string): asserts v is ResultSitting {
  if (!(RESULT_SITTINGS as readonly string[]).includes(v)) {
    throw new Error(`Unknown result sitting "${v}".`);
  }
}
export function assertStatus(v: string): asserts v is ResultStatus {
  if (!(RESULT_STATUSES as readonly string[]).includes(v)) {
    throw new Error(`Unknown result status "${v}".`);
  }
}
/** DID and DISQUALIFIED are scored as an F (attempted, 0 points). */
export function countsAsFail(status: ResultStatus): boolean {
  return status === "DID" || status === "DISQUALIFIED";
}
/** INCOMPLETE is pending — excluded from GPA until resolved. */
export function isPending(status: ResultStatus): boolean {
  return status === "INCOMPLETE";
}
