/**
 * Backup types (Phase 17). A backup is a manifest + an encrypted snapshot. The
 * manifest carries everything needed to decrypt and verify (salt/iv/authTag) plus
 * a plaintext SHA-256 checksum and per-table row counts. Pure types — crypto and
 * I/O live in infrastructure.
 */

/** A full data snapshot: table name → its rows. */
export type DatabaseSnapshot = Record<string, Record<string, unknown>[]>;

export interface BackupManifest {
  formatVersion: number;
  createdAt: string;
  /** KDF salt (hex) — fresh per backup. */
  salt: string;
  /** AES-GCM IV (base64) — fresh per backup. */
  iv: string;
  /** AES-GCM auth tag (base64). */
  authTag: string;
  /** SHA-256 (hex) of the plaintext snapshot JSON. */
  checksum: string;
  /** table → row count (informational + sanity check). */
  tables: Record<string, number>;
}

export interface BackupEnvelope {
  manifest: BackupManifest;
  /** AES-256-GCM ciphertext of the snapshot JSON (base64). */
  ciphertext: string;
}

export const BACKUP_FORMAT_VERSION = 1;
