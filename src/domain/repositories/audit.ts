/**
 * Audit query port (Phase 19) — read side of the audit trail. `find` filters +
 * paginates; `listOrdered` returns the whole trail in chain order for
 * verification. The write side stays on the existing append-only `AuditLogPort`.
 */
import type { AuditEntry } from "../services/AuditChain";
import type { Page } from "./records";

export interface AuditQuery {
  actorId?: string;
  entity?: string;
  action?: string;
  from?: string; // ISO inclusive
  to?: string; // ISO inclusive
  skip?: number;
  take?: number;
}

export interface AuditLogQueryRepository {
  find(query: AuditQuery): Promise<Page<AuditEntry>>;
  /** The whole trail in chain order (createdAt asc, id asc) — for verify. */
  listOrdered(): Promise<AuditEntry[]>;
}
