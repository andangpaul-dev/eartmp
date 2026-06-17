/**
 * ProvisionSigningKey — the admin creates (or replaces) a transcript-signing
 * keypair: generate a fresh Ed25519 pair, seal the private key under the chosen
 * passphrase, and store both the sealed private key and the public key as
 * settings. Replacing an existing key INVALIDATES every transcript already
 * signed with the old key, so it requires an explicit `replaceExisting` flag.
 * Gated `security.manage`; the audit entry records the action only — never the
 * key material or the passphrase.
 *
 * Phase F: with an `institutionId` it provisions that institution's DEDICATED
 * key (namespaced settings); without one it provisions the shared global key. A
 * scoped operator may only provision their own institution's key, and only a
 * global administrator may (re)provision the default/global key.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { SecurityError } from "../../../domain/errors/security";
import { AuthorizationError } from "../../../domain/errors/auth";
import { SETTING_KEYS } from "../../../domain/settings/SettingsRegistry";
import { type SettingsRegistry } from "../../../domain/settings/SettingsRegistry";
import {
  hasOwnSigningKey,
  namespacedKey,
  resolveSigningPublic,
  writeSigningKeys,
} from "../../../domain/settings/signingKeys";
import type { SettingRepository } from "../../../domain/repositories/config";
import type { AuditLogPort } from "../../../domain/repositories";
import type { SecretSealerPort } from "../../ports/SecretSealerPort";
import type { SigningKeyFactoryPort } from "../../ports/SigningKeyFactoryPort";
import { requireInScope } from "../../authorization/institutionScope";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

export interface ProvisionSigningKeyInput {
  passphrase: string;
  /** Required to overwrite an existing key (invalidates prior signatures). */
  replaceExisting?: boolean;
  /** Provision a dedicated key for this institution; omit for the global key. */
  institutionId?: string;
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

  /** Does the target already have a key of its own (global or this institution)? */
  private async isProvisioned(institutionId?: string): Promise<boolean> {
    if (institutionId) {
      return hasOwnSigningKey(this.settings, institutionId);
    }
    const pub = await resolveSigningPublic(this.settings, this.registry);
    return pub.length > 0;
  }

  async execute(
    input: ProvisionSigningKeyInput,
    session: SessionContext,
  ): Promise<{ provisioned: true }> {
    // A scoped operator may only touch their own institution's key; the shared
    // global key is reserved for a global administrator.
    if (input.institutionId) {
      requireInScope(input.institutionId, session);
    } else if (!session.isGlobal) {
      throw new AuthorizationError(
        "Only a global administrator may manage the default signing key.",
      );
    }

    if (input.passphrase.length < 8) {
      throw new SecurityError("Passphrase must be at least 8 characters.");
    }
    if (
      (await this.isProvisioned(input.institutionId)) &&
      !input.replaceExisting
    ) {
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

    await writeSigningKeys(
      this.settings,
      this.registry,
      input.institutionId,
      publicKeyPem,
      sealedPrivate,
    );

    await this.audit.record({
      userId: session.actorId,
      action: "PROVISION",
      entity: "SigningKey",
      recordId: input.institutionId
        ? namespacedKey(SETTING_KEYS.transcriptPublicKey, input.institutionId)
        : SETTING_KEYS.transcriptPublicKey,
      newValue: {
        replaced: Boolean(input.replaceExisting),
        institutionId: input.institutionId ?? null,
      },
    });
    return { provisioned: true };
  }
}
