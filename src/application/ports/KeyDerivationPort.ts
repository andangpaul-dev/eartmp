/**
 * KeyDerivationPort — derive an encryption key from an operator passphrase.
 *
 * Groundwork for ADR-008 (encrypt the primary DB at rest) and backup
 * encryption. The interface is defined in Phase 2; the concrete SQLCipher /
 * backup wiring lands with the Tauri-SQL data layer (Phase 7). Defined here so
 * key handling has a single, testable contract from the start.
 */
export interface KeyDerivationPort {
  /**
   * Derive raw key material (hex-encoded) from a passphrase + salt using a
   * memory-hard KDF (Argon2id). Deterministic for a given (passphrase, salt).
   */
  deriveKey(passphrase: string, salt: string): Promise<string>;
}
