/**
 * AuditHasher — the hash primitive for the audit chain (Phase 19). Behind a port
 * so the chain logic is testable without a crypto lib and the algorithm is
 * swappable. Implemented by `Sha256Hasher` (infra).
 */
export interface AuditHasher {
  hash(data: string): string; // hex digest
}
