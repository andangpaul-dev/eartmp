import { describe, it, expect } from "vitest";
import {
  buildDefaultRegistry,
  SETTING_KEYS,
} from "../../src/domain/settings/SettingsRegistry";
import { SettingsError } from "../../src/domain/errors/config";

describe("grading.standingBands setting validation", () => {
  const r = buildDefaultRegistry();
  const key = SETTING_KEYS.standingBands;

  it("accepts well-formed bands and round-trips them", () => {
    const bands = [
      { label: "A", minGpa: 3.5 },
      { label: "B", minGpa: 0 },
    ];
    const raw = r.serialize(key, bands);
    expect(r.deserialize(key, raw)).toEqual(bands);
  });

  it("rejects a non-array", () => {
    expect(() => r.validate(key, { label: "A", minGpa: 1 })).toThrow(
      /must be an array/,
    );
  });

  it("rejects an empty array", () => {
    expect(() => r.validate(key, [])).toThrow(SettingsError);
  });

  it("rejects a band missing/!numeric minGpa", () => {
    expect(() => r.validate(key, [{ label: "A", minGpa: "x" }])).toThrow(
      /finite number/,
    );
  });

  it("rejects an empty label", () => {
    expect(() => r.validate(key, [{ label: "", minGpa: 1 }])).toThrow(
      /label is empty/,
    );
  });
});
