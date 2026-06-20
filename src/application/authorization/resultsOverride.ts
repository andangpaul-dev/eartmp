/**
 * Admin override (WS B §7): a session holding `results.override` may bypass the
 * academic-process restrictions (locks, resit/retake eligibility, roster
 * membership). Tenant isolation is never overridable. Every override path is
 * audited by its caller.
 */
import type { SessionContext } from "../../domain/value-objects/SessionContext";

export const RESULTS_OVERRIDE = "results.override";

export function canOverrideResults(session: SessionContext): boolean {
  return session.has(RESULTS_OVERRIDE);
}
