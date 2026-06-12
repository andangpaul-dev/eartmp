/**
 * Sha256Hasher — AuditHasher over Node `crypto` (Phase 19). Hex SHA-256 digest;
 * the audit chain's hash primitive.
 */
import { createHash } from "node:crypto";
import type { AuditHasher } from "../../application/ports/AuditHasher";

export class Sha256Hasher implements AuditHasher {
  hash(data: string): string {
    return createHash("sha256").update(data, "utf8").digest("hex");
  }
}
