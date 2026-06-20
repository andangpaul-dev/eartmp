import { describe, it, expect } from "vitest";
import {
  buildDefaultRegistry,
  SETTING_KEYS,
} from "../../src/domain/settings/SettingsRegistry";

describe("matricule settings", () => {
  const reg = buildDefaultRegistry();

  it("registers all three matricule keys", () => {
    expect(reg.has(SETTING_KEYS.matriculeRule)).toBe(true);
    expect(reg.has(SETTING_KEYS.matriculeFormat)).toBe(true);
    expect(reg.has(SETTING_KEYS.matriculeCheckScheme)).toBe(true);
  });

  it("defaults checkScheme to 'none'", () => {
    expect(reg.defaultValue(SETTING_KEYS.matriculeCheckScheme)).toBe("none");
  });

  it("rejects an unknown token in the rule", () => {
    expect(() =>
      reg.validate(SETTING_KEYS.matriculeRule, "{faculty}{year2}-{bogus}"),
    ).toThrow('Unknown matricule token "{bogus}"');
  });

  it("accepts a valid rule template", () => {
    const result = reg.validate(
      SETTING_KEYS.matriculeRule,
      "{institutionCode}{faculty}{year2}-{seq:0000}{check}",
    );
    expect(result).toBe("{institutionCode}{faculty}{year2}-{seq:0000}{check}");
  });

  it("accepts 'luhn' as checkScheme", () => {
    expect(reg.validate(SETTING_KEYS.matriculeCheckScheme, "luhn")).toBe(
      "luhn",
    );
  });

  it("rejects 'crc' as checkScheme", () => {
    expect(() =>
      reg.validate(SETTING_KEYS.matriculeCheckScheme, "crc"),
    ).toThrow("matriculeCheckScheme must be none|luhn|mod97");
  });

  it("rejects an invalid regex in matriculeFormat", () => {
    expect(() =>
      reg.validate(SETTING_KEYS.matriculeFormat, "[invalid"),
    ).toThrow("matriculeFormat is not a valid regex");
  });

  it("accepts an empty matriculeFormat (no constraint)", () => {
    expect(reg.validate(SETTING_KEYS.matriculeFormat, "")).toBe("");
  });

  it("accepts a valid regex in matriculeFormat", () => {
    expect(reg.validate(SETTING_KEYS.matriculeFormat, "^[A-Z]{2}\\d{6}$")).toBe(
      "^[A-Z]{2}\\d{6}$",
    );
  });
});
