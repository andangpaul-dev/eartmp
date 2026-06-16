/**
 * ProvisionSigningKey — the admin creates (or replaces) the transcript-signing
 * keypair: generate a fresh Ed25519 pair, seal the private key under the chosen
 * passphrase, and store both the sealed private key and the public key as
 * settings. Replacing an existing key INVALIDATES every transcript already
 * signed with the old key, so it requires an explicit `replaceExisting` flag.
 * Gated `security.manage`; the audit entry records the action only — never the
 * key material or the passphrase.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { SecurityError } from "../../../domain/errors/security";
import {
  SETTING_KEYS,
  type SettingsRegistry,
} from "../../../domain/settings/SettingsRegistry";
import type { SettingRepository } from "../../../domain/repositories/config";
import type { AuditLogPort } from "../../../domain/repositories";
import type { SecretSealerPort } from "../../ports/SecretSealerPort";
import type { SigningKeyFactoryPort } from "../../ports/SigningKeyFactoryPort";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

export interface ProvisionSigningKeyInput {
  passphrase: string;
  /** Required to overwrite an existing key (invalidates prior signatures). */
  replaceExisting?: boolean;
}

export class ProvisionSigningKey implements AuthorizedUseCase<
  ProvisionSigningKeyInput,
  { provisioned: true }
> {
  readonly name = "ProvisionSigningKey";
  readonly requiredPermissions = ["security.manage"];

  constructor(
    private readonly settings: SettingRepository,
    private readonly registry: SettingsRegistry,
    private readonly sealer: SecretSealerPort,
    private readonly factory: SigningKeyFactoryPort,
    private readonly audit: AuditLogPort,
  ) {}

  private async isProvisioned(): Promise<boolean> {
    const raw = await this.settings.getRaw(SETTING_KEYS.transcriptPublicKey);
    const value =
      raw === null
        ? (this.registry.defaultValue(SETTING_KEYS.transcriptPublicKey) ?? "")
        : this.registry.deserialize(SETTING_KEYS.transcriptPublicKey, raw);
    return typeof value === "string" && value.length > 0;
  }

  async execute(
    input: ProvisionSigningKeyInput,
    session: SessionContext,
  ): Promise<{ provisioned: true }> {
    if (input.passphrase.length < 8) {
      throw new SecurityError("Passphrase must be at least 8 characters.");
    }
    if ((await this.isProvisioned()) && !input.replaceExisting) {
      throw new SecurityError(
        "A signing key already exists. Replacing it invalidates every " +
          "previously issued transcript — pass replaceExisting to confirm.",
      );
    }

    const { publicKeyPem, privateKeyPem } = this.factory.generateKeypair();
    const sealedPrivate = await this.sealer.seal(
      privateKeyPem,
      input.passphrase,
    );

    await this.settings.setRaw(
      SETTING_KEYS.transcriptPublicKey,
      this.registry.serialize(SETTING_KEYS.transcriptPublicKey, publicKeyPem),
    );
    await this.settings.setRaw(
      SETTING_KEYS.transcriptPrivateKey,
      this.registry.serialize(SETTING_KEYS.transcriptPrivateKey, sealedPrivate),
    );

    await this.audit.record({
      userId: session.actorId,
      action: "PROVISION",
      entity: "SigningKey",
      recordId: SETTING_KEYS.transcriptPublicKey,
      newValue: { replaced: Boolean(input.replaceExisting) },
    });
    return { provisioned: true };
  }
}
