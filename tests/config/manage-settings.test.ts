import { describe, it, expect } from "vitest";
import {
  GetSetting,
  SetSetting,
  ListSettings,
} from "../../src/application/use-cases/config/ManageSettings";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import {
  buildDefaultRegistry,
  SETTING_KEYS,
} from "../../src/domain/settings/SettingsRegistry";
import { SettingsError } from "../../src/domain/errors/config";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { CapturingAudit } from "../auth/fakes";
import { InMemorySettingRepository } from "./fakes";

const manager = SessionContext.create("u1", "ADMIN", [
  "settings.read",
  "settings.manage",
]);
const reader = SessionContext.create("u2", "VIEWER", ["settings.read"]);

describe("GetSetting", () => {
  it("returns the registered default when unset", async () => {
    const uc = new GetSetting(
      new InMemorySettingRepository(),
      buildDefaultRegistry(),
    );
    expect(await uc.execute({ key: SETTING_KEYS.defaultScaleName })).toBe(
      "Default 5-Point Scale",
    );
  });

  it("returns and validates a stored value", async () => {
    const registry = buildDefaultRegistry();
    const repo = new InMemorySettingRepository({
      [SETTING_KEYS.defaultScaleName]: registry.serialize(
        SETTING_KEYS.defaultScaleName,
        "Custom",
      ),
    });
    const uc = new GetSetting(repo, registry);
    expect(await uc.execute({ key: SETTING_KEYS.defaultScaleName })).toBe(
      "Custom",
    );
  });

  it("throws on an unknown key", async () => {
    const uc = new GetSetting(
      new InMemorySettingRepository(),
      buildDefaultRegistry(),
    );
    await expect(uc.execute({ key: "nope" })).rejects.toBeInstanceOf(
      SettingsError,
    );
  });
});

describe("SetSetting", () => {
  function build() {
    const repo = new InMemorySettingRepository();
    const audit = new CapturingAudit();
    const uc = new SetSetting(repo, buildDefaultRegistry(), audit);
    return { uc, repo, audit };
  }

  it("validates, persists, and audits old→new", async () => {
    const { uc, repo, audit } = build();
    await uc.execute(
      {
        key: SETTING_KEYS.passwordPolicy,
        value: { minLength: 14, requireNumber: true, requireUppercase: false },
      },
      manager,
    );
    expect(JSON.parse(repo.store.get(SETTING_KEYS.passwordPolicy)!)).toEqual({
      schemaVersion: 1,
      value: { minLength: 14, requireNumber: true, requireUppercase: false },
    });
    expect(audit.entries[0]).toMatchObject({
      action: "UPDATE",
      entity: "Setting",
      recordId: SETTING_KEYS.passwordPolicy,
    });
    // old value was the default
    expect(audit.entries[0]!.oldValue).toMatchObject({ minLength: 10 });
  });

  it("rejects an invalid value (no write, no audit)", async () => {
    const { uc, repo, audit } = build();
    await expect(
      uc.execute(
        { key: SETTING_KEYS.argon2Params, value: { memoryCost: 0 } },
        manager,
      ),
    ).rejects.toBeInstanceOf(SettingsError);
    expect(repo.store.size).toBe(0);
    expect(audit.entries).toHaveLength(0);
  });

  it("is denied through the seam without settings.manage", async () => {
    const { uc } = build();
    await expect(
      authorize(uc, { key: SETTING_KEYS.defaultScaleName, value: "x" }, reader),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("ListSettings", () => {
  it("lists all known settings with default/stored values", async () => {
    const registry = buildDefaultRegistry();
    const repo = new InMemorySettingRepository({
      [SETTING_KEYS.defaultScaleName]: registry.serialize(
        SETTING_KEYS.defaultScaleName,
        "Custom",
      ),
    });
    const uc = new ListSettings(repo, registry);
    const views = await uc.execute({}, reader);
    expect(views).toHaveLength(registry.keys().length);
    const scale = views.find((v) => v.key === SETTING_KEYS.defaultScaleName)!;
    expect(scale.value).toBe("Custom");
    expect(scale.isDefault).toBe(false);
    const salt = views.find((v) => v.key === SETTING_KEYS.encryptionSalt)!;
    expect(salt.isDefault).toBe(true);
    expect(salt.description).toMatch(/Salt/);
  });
});
