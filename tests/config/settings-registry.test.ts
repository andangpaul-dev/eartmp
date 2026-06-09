import { describe, it, expect } from "vitest";
import {
  buildDefaultRegistry,
  SETTING_KEYS,
} from "../../src/domain/settings/SettingsRegistry";
import { SettingsError } from "../../src/domain/errors/config";

describe("SettingsRegistry", () => {
  const r = buildDefaultRegistry();

  it("registers all known settings", () => {
    expect(r.keys()).toEqual(Object.values(SETTING_KEYS));
    expect(r.has(SETTING_KEYS.passwordPolicy)).toBe(true);
    expect(r.has("nope")).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(() => r.validate("nope", 1)).toThrow(SettingsError);
    expect(() => r.defaultValue("nope")).toThrow(/Unknown setting/);
  });

  it("validates a good password policy and rejects bad ones", () => {
    const good = { minLength: 12, requireNumber: true, requireUppercase: true };
    expect(r.validate(SETTING_KEYS.passwordPolicy, good)).toEqual(good);
    expect(() =>
      r.validate(SETTING_KEYS.passwordPolicy, { minLength: 4 }),
    ).toThrow(SettingsError);
    expect(() => r.validate(SETTING_KEYS.passwordPolicy, "x")).toThrow(
      /must be an object/,
    );
  });

  it("validates argon2 params as positive integers", () => {
    expect(() =>
      r.validate(SETTING_KEYS.argon2Params, {
        memoryCost: -1,
        timeCost: 3,
        parallelism: 1,
      }),
    ).toThrow(/positive integer/);
  });

  it("round-trips through serialize/deserialize with a schemaVersion envelope", () => {
    const raw = r.serialize(SETTING_KEYS.defaultScaleName, "My Scale");
    expect(JSON.parse(raw)).toEqual({ schemaVersion: 1, value: "My Scale" });
    expect(r.deserialize(SETTING_KEYS.defaultScaleName, raw)).toBe("My Scale");
  });

  it("rejects corrupt or malformed stored envelopes", () => {
    expect(() => r.deserialize(SETTING_KEYS.defaultScaleName, "{")).toThrow(
      /corrupt JSON/,
    );
    expect(() =>
      r.deserialize(
        SETTING_KEYS.defaultScaleName,
        JSON.stringify({ value: 1 }),
      ),
    ).toThrow(/malformed/);
  });

  it("rejects a serialize of an invalid value", () => {
    expect(() => r.serialize(SETTING_KEYS.argon2Params, "nope")).toThrow(
      SettingsError,
    );
  });

  it("exposes schemaVersion and description", () => {
    expect(r.schemaVersion(SETTING_KEYS.argon2Params)).toBe(1);
    expect(r.description(SETTING_KEYS.encryptionSalt)).toMatch(/Salt/);
  });

  it("refuses duplicate registration", () => {
    expect(() =>
      r.register({
        key: SETTING_KEYS.argon2Params,
        schemaVersion: 1,
        description: "dup",
        default: 0,
        validate: (v) => v,
      }),
    ).toThrow(/already registered/);
  });
});
