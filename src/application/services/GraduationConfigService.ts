/**
 * GraduationConfigService — loads the validated `graduation.requirements` setting
 * through the registry (Phase 16, AD16.1). Single choke point so a misconfigured
 * value can never reach the evaluator unvalidated.
 */
import {
  SETTING_KEYS,
  type SettingsRegistry,
} from "../../domain/settings/SettingsRegistry";
import type { SettingRepository } from "../../domain/repositories/config";
import type { GraduationRequirements } from "../../domain/services/GraduationEligibility";

export class GraduationConfigService {
  constructor(
    private readonly settings: SettingRepository,
    private readonly registry: SettingsRegistry,
  ) {}

  async loadRequirements(): Promise<GraduationRequirements> {
    const raw = await this.settings.getRaw(SETTING_KEYS.graduationRequirements);
    const value =
      raw === null
        ? this.registry.defaultValue(SETTING_KEYS.graduationRequirements)
        : this.registry.deserialize(SETTING_KEYS.graduationRequirements, raw);
    return value as GraduationRequirements;
  }
}
