/**
 * Settings use-cases: GetSetting, SetSetting, ListSettings.
 *
 * All values flow through the SettingsRegistry, so reads and writes are typed,
 * validated, and schema-versioned (F-25). Writes are permission-gated and
 * audited (old → new). A read of an unset key returns the registered default.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import type {
  SettingsRegistry,
  SettingView,
} from "../../../domain/settings/SettingsRegistry";
import type { SettingRepository } from "../../../domain/repositories/config";
import type { AuditLogPort } from "../../../domain/repositories";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

export interface GetSettingInput {
  key: string;
}

export class GetSetting implements AuthorizedUseCase<GetSettingInput, unknown> {
  readonly name = "GetSetting";
  readonly requiredPermissions = ["settings.read"];

  constructor(
    private readonly settings: SettingRepository,
    private readonly registry: SettingsRegistry,
  ) {}

  async execute(input: GetSettingInput): Promise<unknown> {
    // Validates the key exists (throws SettingsError if unknown).
    const fallback = this.registry.defaultValue(input.key);
    const raw = await this.settings.getRaw(input.key);
    if (raw === null) return fallback;
    return this.registry.deserialize(input.key, raw);
  }
}

export interface SetSettingInput {
  key: string;
  value: unknown;
}

export class SetSetting implements AuthorizedUseCase<SetSettingInput, void> {
  readonly name = "SetSetting";
  readonly requiredPermissions = ["settings.manage"];

  constructor(
    private readonly settings: SettingRepository,
    private readonly registry: SettingsRegistry,
    private readonly audit: AuditLogPort,
  ) {}

  async execute(
    input: SetSettingInput,
    session: SessionContext,
  ): Promise<void> {
    // Validate + serialize through the registry (rejects unknown key / bad value).
    const serialized = this.registry.serialize(input.key, input.value);

    const previousRaw = await this.settings.getRaw(input.key);
    const oldValue =
      previousRaw === null
        ? this.registry.defaultValue(input.key)
        : this.registry.deserialize(input.key, previousRaw);

    await this.settings.setRaw(input.key, serialized);
    await this.audit.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "Setting",
      recordId: input.key,
      oldValue,
      newValue: this.registry.validate(input.key, input.value),
    });
  }
}

export class ListSettings implements AuthorizedUseCase<
  Record<string, never>,
  SettingView[]
> {
  readonly name = "ListSettings";
  readonly requiredPermissions = ["settings.read"];

  constructor(
    private readonly settings: SettingRepository,
    private readonly registry: SettingsRegistry,
  ) {}

  async execute(
    _input: Record<string, never>,
    _session: SessionContext,
  ): Promise<SettingView[]> {
    const stored = new Map(
      (await this.settings.all()).map((s) => [s.key, s.value]),
    );
    return this.registry.keys().map((key) => {
      const raw = stored.get(key);
      const isDefault = raw === undefined;
      const value = isDefault
        ? this.registry.defaultValue(key)
        : this.registry.deserialize(key, raw);
      return {
        key,
        schemaVersion: this.registry.schemaVersion(key),
        value,
        isDefault,
        description: this.registry.description(key),
      };
    });
  }
}
