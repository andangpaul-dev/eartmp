import { describe, it, expect } from "vitest";
import { validateMethodInput } from "../../src/host/inputSchemas";
import { ValidationError } from "../../src/domain/errors/validation";

describe("validateMethodInput", () => {
  it("accepts a well-formed payload and preserves extra keys", () => {
    const out = validateMethodInput("generateTranscript", {
      studentId: "s1",
      templateId: "t1",
      extra: 42,
    }) as Record<string, unknown>;
    expect(out.studentId).toBe("s1");
    expect(out.extra).toBe(42); // unknown keys kept (looseObject)
  });

  it("rejects a missing required field with a ValidationError", () => {
    expect(() =>
      validateMethodInput("generateTranscript", { templateId: "t1" }),
    ).toThrow(ValidationError);
  });

  it("rejects a wrong-typed field", () => {
    expect(() =>
      validateMethodInput("verifyTranscript", { transcriptId: 123 }),
    ).toThrow(ValidationError);
  });

  it("validates security-critical inputs (login needs username + password)", () => {
    expect(() => validateMethodInput("login", { username: "a" })).toThrow(
      ValidationError,
    );
    expect(
      validateMethodInput("login", { username: "a", password: "b" }),
    ).toEqual({ username: "a", password: "b" });
  });

  it("applies a baseline object guard to unschematised methods", () => {
    // An object passes…
    expect(validateMethodInput("listStudents", { where: {} })).toEqual({
      where: {},
    });
    // …null/undefined become an empty object…
    expect(validateMethodInput("listStudents", undefined)).toEqual({});
    // …but a primitive is rejected.
    expect(() => validateMethodInput("listStudents", "nope")).toThrow(
      ValidationError,
    );
  });
});
