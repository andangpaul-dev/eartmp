/**
 * SealedSigningKeyProvider — opens the sealed transcript-signing private key with
 * the operator passphrase and returns a `CryptoSignatureService` (Phase 18,
 * AD18.3). The private key is decrypted in memory only; it is never persisted in
 * the clear, logged, or returned to callers.
 */
import {
  SETTING_KEYS,
  type SettingsRegistry,
} from "../../domain/settings/SettingsRegistry";
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

  private async load(key: string): Promise<string> {
    const raw = await this.settings.getRaw(key);
    const value =
      raw === null
        ? this.registry.defaultValue(key)
        : this.registry.deserialize(key, raw);
    return value as string;
  }

  async getSigner(passphrase: string): Promise<SignaturePort> {
    const sealedPrivate = await this.load(SETTING_KEYS.transcriptPrivateKey);
    const publicPem = await this.load(SETTING_KEYS.transcriptPublicKey);
    if (!sealedPrivate || !publicPem) {
      throw new SecurityError("Transcript signing key is not provisioned.");
    }
    const privatePem = await this.box.open(sealedPrivate, passphrase);
    return new CryptoSignatureService(privatePem, publicPem);
  }
}
