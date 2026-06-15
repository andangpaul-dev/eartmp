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
  reason: "content" | "linkage" | "missing-hash";
}

export interface ChainVerification {
  valid: boolean;
  checked: number; // chained entries verified
  total: number; // entries seen (so callers notice unverified coverage)
  brokenAt?: ChainBreak;
}

/** Anchor for the first chained entry's prevHash (empty = chain origin). */
const GENESIS = "";

/**
 * Verify an ordered list of entries using `link(prevHash, payload) -> hash`.
 *
 * Leading entries with no `hash` are legacy pre-chain rows and are skipped. Once
 * the chain has started, however, a hashless entry is a tamper signal
 * ("missing-hash") — this catches a nulled hash on the LAST entry, which a plain
 * skip would otherwise hide (no following entry to fail the linkage check). The
 * first chained entry must anchor to GENESIS, so a deleted prefix can't be
 * re-presented as a valid chain head.
 */
export function verifyAuditChain(
  ordered: AuditEntry[],
  link: (prevHash: string, payload: string) => string,
): ChainVerification {
  let checked = 0;
  let started = false;
  let lastHash = GENESIS;
  const total = ordered.length;

  for (let i = 0; i < total; i++) {
    const e = ordered[i]!;
    const hasHash = e.hash !== undefined && e.hash !== null;

    if (!started && !hasHash) continue; // leading legacy unchained → skip
    if (started && !hasHash) {
      return {
        valid: false,
        checked,
        total,
        brokenAt: brk(i, e, "missing-hash"),
      };
    }

    // Linkage: first chained entry anchors to GENESIS, the rest to the prior hash.
    if ((e.prevHash ?? GENESIS) !== lastHash) {
      return { valid: false, checked, total, brokenAt: brk(i, e, "linkage") };
    }
    // Content: recompute from the stored prevHash + canonical payload.
    const expected = link(e.prevHash ?? GENESIS, canonicalAuditPayload(e));
    if (expected !== e.hash) {
      return { valid: false, checked, total, brokenAt: brk(i, e, "content") };
    }
    checked++;
    started = true;
    lastHash = e.hash!;
  }
  return { valid: true, checked, total };
}

function brk(
  index: number,
  e: AuditEntry,
  reason: ChainBreak["reason"],
): ChainBreak {
  return { index, id: e.id, reason };
}
