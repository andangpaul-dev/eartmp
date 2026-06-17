/**
 * SealedSigningKeyProvider — opens the sealed transcript-signing private key with
 * the operator passphrase and returns a `CryptoSignatureService` (Phase 18,
 * AD18.3). The private key is decrypted in memory only; it is never persisted in
 * the clear, logged, or returned to callers.
 *
 * Phase F: resolves the institution's own key, falling back to the shared global
 * key when an institution has none. `getVerifier` builds a verify-only signer
 * from the public key (no passphrase) for third-party verification.
 */
import { type SettingsRegistry } from "../../domain/settings/SettingsRegistry";
import {
  resolveSigningPrivate,
  resolveSigningPublic,
} from "../../domain/settings/signingKeys";
import { SecurityError } from "../../domain/errors/security";
import type { SettingRepository } from "../../domain/repositories/config";
import type { SigningKeyProvider } from "../../application/ports/SigningKeyProvider";
import type { SignaturePort } from "../../application/ports/SignaturePort";
import { CryptoSignatureService } from "./CryptoSignatureService";
import { SecretBox } from "./SecretBox";

export class SealedSigningKeyProvider implements SigningKeyProvider {
  constructor(
    private readonly settings: SettingRepository,
    private readonly registry: SettingsRegistry,
    private readonly box: SecretBox,
  ) {}

  async getSigner(
    passphrase: string,
    institutionId?: string,
  ): Promise<SignaturePort> {
    const sealedPrivate = await resolveSigningPrivate(
      this.settings,
      this.registry,
      institutionId,
    );
    const publicPem = await resolveSigningPublic(
      this.settings,
      this.registry,
      institutionId,
    );
    if (!sealedPrivate || !publicPem) {
      throw new SecurityError("Transcript signing key is not provisioned.");
    }
    const privatePem = await this.box.open(sealedPrivate, passphrase);
    return new CryptoSignatureService(privatePem, publicPem);
  }

  async getVerifier(institutionId?: string): Promise<SignaturePort | null> {
    const publicPem = await resolveSigningPublic(
      this.settings,
      this.registry,
      institutionId,
    );
    if (!publicPem) return null;
    return CryptoSignatureService.verifier(publicPem);
  }
}
