/**
 * Student status workflow — the allowed-transition matrix (AD6.1). Terminal
 * states (WITHDRAWN, GRADUATED) have no outgoing transitions. Kept as data so a
 * different institution policy is a config/edit, not a rewrite.
 */
import type { StudentStatus } from "./index";

export const STUDENT_STATUS_TRANSITIONS: Record<
  StudentStatus,
  readonly StudentStatus[]
> = {
  ACTIVE: ["SUSPENDED", "DEFERRED", "WITHDRAWN", "GRADUATED"],
  SUSPENDED: ["ACTIVE", "WITHDRAWN"],
  DEFERRED: ["ACTIVE", "WITHDRAWN"],
  WITHDRAWN: [],
  GRADUATED: [],
};

export function canTransition(from: StudentStatus, to: StudentStatus): boolean {
  return STUDENT_STATUS_TRANSITIONS[from].includes(to);
}
