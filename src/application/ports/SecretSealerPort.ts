/**
 * SecretSealerPort — seal/open secrets with the operator passphrase (Phase 18).
 * The use-cases depend on this; the AES-GCM `SecretBox` implements it.
 */
export interface SecretSealerPort {
  seal(secret: string, passphrase: string): Promise<string>;
  /** Throws SecurityError on a tampered blob or wrong passphrase. */
  open(sealed: string, passphrase: string): Promise<string>;
}
