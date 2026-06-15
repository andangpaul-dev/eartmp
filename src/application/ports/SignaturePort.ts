/**
 * SignaturePort — sign and verify transcript snapshots (ADR-009 / F-14). The
 * use-cases depend on this interface, not on a crypto library. The institution's
 * private key signs; the public key verifies, so a transcript is verifiable by a
 * third party with the public key and no database.
 */
export interface SignatureResult {
  signature: string; // base64
  keyId: string; // short id of the signing public key
}

export interface SignaturePort {
  sign(data: string): SignatureResult;
  /** Verify a signature against the configured public key. Never throws. */
  verify(data: string, signature: string): boolean;
  /** Short id of the configured public key (to detect a rotated key on verify). */
  readonly keyId?: string;
}
