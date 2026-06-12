/**
 * ChangeKeyPassphrase — re-seal the transcript-signing private key under a new
 * operator passphrase (Phase 18, AD18.3/AD18.4). Opens with the old passphrase,
 * re-seals with the new; the raw key stays in memory and is NEVER logged or
 * audited. Gated by `security.manage`; the audit entry records the action only.
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
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

export interface ChangeKeyPassphraseInput {
  oldPassphrase: string;
  newPassphrase: string;
}

export class ChangeKeyPassphrase implements AuthorizedUseCase<
  ChangeKeyPassphraseInput,
  void
> {
  readonly name = "ChangeKeyPassphrase";
  readonly requiredPermissions = ["security.manage"];

  constructor(
    private readonly settings: SettingRepository,
    private readonly registry: SettingsRegistry,
    private readonly sealer: SecretSealerPort,
    private readonly audit: AuditLogPort,
  ) {}

  async execute(
    input: ChangeKeyPassphraseInput,
    session: SessionContext,
  ): Promise<void> {
    const raw = await this.settings.getRaw(SETTING_KEYS.transcriptPrivateKey);
    const sealed =
      raw === null
        ? (this.registry.defaultValue(
            SETTING_KEYS.transcriptPrivateKey,
          ) as string)
        : (this.registry.deserialize(
            SETTING_KEYS.transcriptPrivateKey,
            raw,
          ) as string);

    let privatePem: string;
    try {
      privatePem = await this.sealer.open(sealed, input.oldPassphrase);
    } catch {
      throw new SecurityError("Current passphrase is incorrect.");
    }

    const resealed = await this.sealer.seal(privatePem, input.newPassphrase);
    await this.settings.setRaw(
      SETTING_KEYS.transcriptPrivateKey,
      this.registry.serialize(SETTING_KEYS.transcriptPrivateKey, resealed),
    );

    // Audit the action only — never the key or either passphrase (AD18.4).
    await this.audit.record({
      userId: session.actorId,
      action: "CHANGE_KEY_PASSPHRASE",
      entity: "Setting",
      recordId: SETTING_KEYS.transcriptPrivateKey,
    });
  }
}
