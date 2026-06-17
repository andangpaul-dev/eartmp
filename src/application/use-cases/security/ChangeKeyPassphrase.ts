/**
 * ChangeKeyPassphrase — re-seal a transcript-signing private key under a new
 * operator passphrase (Phase 18, AD18.3/AD18.4). Opens with the old passphrase,
 * re-seals with the new; the raw key stays in memory and is NEVER logged or
 * audited. Gated by `security.manage`; the audit entry records the action only.
 *
 * Phase F: with an `institutionId` it rotates that institution's DEDICATED key;
 * without one it rotates the shared global key. A scoped operator may only rotate
 * their own institution's key, and an institution must already own a dedicated
 * key for a per-institution rotation.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { SecurityError } from "../../../domain/errors/security";
import { AuthorizationError } from "../../../domain/errors/auth";
import { SETTING_KEYS } from "../../../domain/settings/SettingsRegistry";
import { type SettingsRegistry } from "../../../domain/settings/SettingsRegistry";
import {
  namespacedKey,
  readOwnSealedPrivate,
  resolveSigningPublic,
  resolveSigningPrivate,
  writeSigningKeys,
} from "../../../domain/settings/signingKeys";
import type { SettingRepository } from "../../../domain/repositories/config";
import type { AuditLogPort } from "../../../domain/repositories";
import type { SecretSealerPort } from "../../ports/SecretSealerPort";
import { requireInScope } from "../../authorization/institutionScope";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

export interface ChangeKeyPassphraseInput {
  oldPassphrase: string;
  newPassphrase: string;
  /** Rotate this institution's dedicated key; omit for the global key. */
  institutionId?: string;
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
    if (input.institutionId) {
      requireInScope(input.institutionId, session);
    } else if (!session.isGlobal) {
      throw new AuthorizationError(
        "Only a global administrator may manage the default signing key.",
      );
    }

    // For a per-institution rotation the institution must own a dedicated key
    // (rotating wouldn't make sense against the shared global key it falls back
    // to). For the global key, read it via the usual fallback path.
    const sealed = input.institutionId
      ? await readOwnSealedPrivate(this.settings, input.institutionId)
      : await resolveSigningPrivate(this.settings, this.registry);
    if (!sealed) {
      throw new SecurityError(
        input.institutionId
          ? "This institution has no dedicated signing key to rotate."
          : "Transcript signing key is not provisioned.",
      );
    }

    let privatePem: string;
    try {
      privatePem = await this.sealer.open(sealed, input.oldPassphrase);
    } catch {
      throw new SecurityError("Current passphrase is incorrect.");
    }

    const resealed = await this.sealer.seal(privatePem, input.newPassphrase);
    // Re-write only the private half; the public key is unchanged. For an
    // institution that means rewriting its namespaced public PEM too (cheap,
    // keeps the pair consistent in one helper call).
    const publicPem = await resolveSigningPublic(
      this.settings,
      this.registry,
      input.institutionId,
    );
    await writeSigningKeys(
      this.settings,
      this.registry,
      input.institutionId,
      publicPem,
      resealed,
    );

    // Audit the action only — never the key or either passphrase (AD18.4).
    await this.audit.record({
      userId: session.actorId,
      action: "CHANGE_KEY_PASSPHRASE",
      entity: "Setting",
      recordId: input.institutionId
        ? namespacedKey(SETTING_KEYS.transcriptPrivateKey, input.institutionId)
        : SETTING_KEYS.transcriptPrivateKey,
    });
  }
}
