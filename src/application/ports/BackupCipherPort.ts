/**
 * BackupCipherPort — authenticated encryption for backups (Phase 17). The
 * use-cases depend on this, not on a crypto library. AES-256-GCM behind the
 * scenes (the auth tag verifies integrity on decrypt); the key is derived from
 * the operator passphrase and never stored.
 */
export interface CipherParams {
  salt: string; // KDF salt (hex)
  iv: string; // GCM IV (base64)
  authTag: string; // GCM auth tag (base64)
}

export interface EncryptResult extends CipherParams {
  ciphertext: string; // base64
}

export interface BackupCipherPort {
  encrypt(plaintext: string, passphrase: string): Promise<EncryptResult>;
  /** Decrypt + authenticate; throws if the auth tag / passphrase is wrong. */
  decrypt(
    ciphertext: string,
    passphrase: string,
    params: CipherParams,
  ): Promise<string>;
  /** SHA-256 (hex) of the plaintext — the manifest's second integrity gate. */
  checksum(plaintext: string): string;
}
