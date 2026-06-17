/**
 * SigningKeyProvider — yields a transcript SignaturePort by opening the SEALED
 * private key with the operator passphrase (Phase 18). The raw key never leaves
 * the provider; callers get only the signer. A wrong passphrase throws before any
 * signing happens.
 *
 * Phase F: keys are per-institution. Both methods take an optional institutionId;
 * an institution with no dedicated key falls back to the shared global key, so
 * single-institution deployments are unchanged. `getVerifier` needs no passphrase
 * (verification uses only the public key) and returns null when no key exists.
 */
import type { SignaturePort } from "./SignaturePort";

export interface SigningKeyProvider {
  getSigner(passphrase: string, institutionId?: string): Promise<SignaturePort>;
  getVerifier(institutionId?: string): Promise<SignaturePort | null>;
}
