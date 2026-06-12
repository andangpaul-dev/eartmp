/**
 * SigningKeyProvider — yields a transcript SignaturePort by opening the SEALED
 * private key with the operator passphrase (Phase 18). The raw key never leaves
 * the provider; callers get only the signer. A wrong passphrase throws before any
 * signing happens.
 */
import type { SignaturePort } from "./SignaturePort";

export interface SigningKeyProvider {
  getSigner(passphrase: string): Promise<SignaturePort>;
}
