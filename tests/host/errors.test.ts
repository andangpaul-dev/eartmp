/**
 * Host error mapping: domain errors → the serializable CoreError the webview
 * understands, including per-field validation messages.
 */
import { describe, it, expect } from "vitest";
import { toCoreError } from "../../src/host/errors";
import { ValidationError } from "../../src/domain/errors/validation";
import { RecordsError } from "../../src/domain/errors/records";
import { ConcurrencyError } from "../../src/domain/errors/persistence";

describe("toCoreError", () => {
  it("classifies ValidationError as VALIDATION and forwards fields", () => {
    const e = toCoreError(
      ValidationError.field(
        "username",
        "Username must be at least 3 characters.",
      ),
    );
    expect(e.code).toBe("VALIDATION");
    expect(e.fields).toEqual({
      username: "Username must be at least 3 characters.",
    });
  });

  it("forwards RecordsError fields (e.g. duplicate matric)", () => {
    const e = toCoreError(
      new RecordsError('Matric number "M/1" is already in use.', {
        matricNumber: 'Matric number "M/1" is already in use.',
      }),
    );
    // A duplicate message still classifies as CONFLICT, with the field attached.
    expect(e.code).toBe("CONFLICT");
    expect(e.fields?.matricNumber).toMatch(/already in use/);
  });

  it("omits fields when the error carries none", () => {
    expect(toCoreError(new ConcurrencyError()).fields).toBeUndefined();
    expect(toCoreError(new Error("boom")).code).toBe("INTERNAL");
  });
});
