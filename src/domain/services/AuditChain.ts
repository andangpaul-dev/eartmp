/**
 * Audit hash chain (Phase 19). Pure helpers for a tamper-evident, append-only
 * audit trail: each entry's `hash` covers the previous hash + a CANONICAL payload
 * of its content. Editing, deleting, or reordering any entry breaks every later
 * link. The SHA-256 itself is an `AuditHasher` port (infra) — this module only
 * builds the deterministic payload and walks/verifies a chain.
 */

/** Stored audit entry (the shape query + verify operate on). */
export interface AuditEntry {
  id: string;
  userId?: string;
  action: string;
  entity: string;
  recordId?: string;
  oldValue?: string; // JSON string as stored
  newValue?: string; // JSON string as stored
  createdAt: string; // ISO
  prevHash?: string;
  hash?: string;
}

/**
 * Deterministic, order-stable serialization of an entry's CONTENT (never the
 * hash/prevHash/id). A fixed-order array keeps it stable across runs/engines.
 */
export function canonicalAuditPayload(e: {
  userId?: string;
  action: string;
  entity: string;
  recordId?: string;
  oldValue?: string;
  newValue?: string;
  createdAt: string;
}): string {
  return JSON.stringify([
    e.userId ?? null,
    e.action,
    e.entity,
    e.recordId ?? null,
    e.oldValue ?? null,
    e.newValue ?? null,
    e.createdAt,
  ]);
}

export interface ChainBreak {
  index: number;
  id: string;
  reason: "content" | "linkage";
}

export interface ChainVerification {
  valid: boolean;
  checked: number; // chained entries verified
  brokenAt?: ChainBreak;
}

/**
 * Verify an ordered list of entries using `link(prevHash, payload) -> hash`.
 * Entries with no `hash` are treated as pre-chain (unchained) and skipped. The
 * first content or linkage mismatch is reported.
 */
export function verifyAuditChain(
  ordered: AuditEntry[],
  link: (prevHash: string, payload: string) => string,
): ChainVerification {
  let checked = 0;
  let lastHash: string | undefined;
  for (let i = 0; i < ordered.length; i++) {
    const e = ordered[i]!;
    if (e.hash === undefined || e.hash === null) continue; // unchained
    // Linkage: prevHash must equal the previous chained entry's hash.
    if ((e.prevHash ?? undefined) !== lastHash) {
      return {
        valid: false,
        checked,
        brokenAt: { index: i, id: e.id, reason: "linkage" },
      };
    }
    // Content: recompute the hash from the stored prevHash + canonical payload.
    const expected = link(e.prevHash ?? "", canonicalAuditPayload(e));
    if (expected !== e.hash) {
      return {
        valid: false,
        checked,
        brokenAt: { index: i, id: e.id, reason: "content" },
      };
    }
    checked++;
    lastHash = e.hash;
  }
  return { valid: true, checked };
}
