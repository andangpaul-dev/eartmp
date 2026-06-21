/**
 * parseWorkbook permission gate: any authenticated session (regardless of
 * permissions) can call parseWorkbook; an unauthenticated call is rejected.
 *
 * We build a minimal Host whose registry contains the exact same guard logic
 * as composition.ts and drive it through createCore's dispatch, which is the
 * path the real app uses.
 */
import { describe, it, expect } from "vitest";
import { createCore } from "../../src/host/dispatcher";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { AuthenticationError } from "../../src/domain/errors/auth";
import { SheetJsReader } from "../../src/infrastructure/import/SheetJsReader";
import type { Host } from "../../src/host/composition";

/** A CSV with a code/title header + one data row, base64-encoded. */
const CSV_B64 = Buffer.from("code,title\nC1,Course").toString("base64");

/** Build a minimal Host with only the parseWorkbook handler wired. */
function fakeHost(): Host {
  const registry = new Map<
    string,
    (i: unknown, s: SessionContext | null) => Promise<unknown>
  >();

  // Mirror the composition.ts parseWorkbook handler exactly.
  registry.set("parseWorkbook", async (i, s) => {
    if (!s) throw new AuthenticationError("Authentication required.");
    const bytes = new Uint8Array(
      Buffer.from((i as { base64: string }).base64, "base64"),
    );
    return new SheetJsReader().read(bytes);
  });

  const session = SessionContext.create("u1", "COURSE_ADMIN", [
    "courses.create",
  ]);

  return {
    authenticate: {
      name: "AuthenticateUser",
      isPublic: true,
      requiredPermissions: [],
      execute: async () => session,
    } as never,
    registry,
  } as unknown as Host;
}

describe("parseWorkbook permission gate", () => {
  it("resolves rows when the caller is authenticated (no results.import needed)", async () => {
    const core = createCore(fakeHost());
    const { token } = await core.login({ username: "admin", password: "x" });

    const env = await core.dispatch(
      "parseWorkbook",
      { base64: CSV_B64 },
      token,
    );
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const rows = env.data as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: "C1", title: "Course" });
  });

  it("rejects with ok:false when there is no session (unauthenticated)", async () => {
    const core = createCore(fakeHost());
    // No token passed → session resolves to null.
    const env = await core.dispatch("parseWorkbook", { base64: CSV_B64 });
    expect(env.ok).toBe(false);
    if (env.ok) return;
    expect(env.error.code).toBe("UNAUTHENTICATED");
  });
});
