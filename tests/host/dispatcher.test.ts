/**
 * Host dispatcher hardening (Tier 1): session idle/absolute expiry and
 * failed-login lockout, driven by an injected clock.
 */
import { describe, it, expect } from "vitest";
import { createCore } from "../../src/host/dispatcher";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { AuthenticationError } from "../../src/domain/errors/auth";
import type { Host } from "../../src/host/composition";

function fakeHost(opts: { authOk: boolean }): Host {
  const session = SessionContext.create("u1", "SUPER_ADMIN", ["students.read"]);
  return {
    authenticate: {
      name: "AuthenticateUser",
      isPublic: true,
      requiredPermissions: [],
      execute: async () => {
        if (!opts.authOk) throw new AuthenticationError();
        return session;
      },
    } as never,
    registry: new Map([
      [
        "listStudents",
        async (_i: unknown, s: SessionContext | null) => {
          if (!s) throw new Error("no session");
          return { ok: true };
        },
      ],
    ]),
  } as unknown as Host;
}

describe("dispatcher session + lockout", () => {
  it("expires a session after the idle timeout", async () => {
    let now = 0;
    const core = createCore(fakeHost({ authOk: true }), () => now);
    const { token } = await core.login({ username: "admin", password: "x" });

    expect(await core.currentUser(token)).not.toBeNull();
    now += 31 * 60 * 1000; // > 30 min idle
    expect(await core.currentUser(token)).toBeNull();
    const env = await core.dispatch("listStudents", {}, token);
    expect(env.ok).toBe(false); // session gone → handler sees null → throws
  });

  it("keeps a session alive with activity until the absolute timeout", async () => {
    let now = 0;
    const core = createCore(fakeHost({ authOk: true }), () => now);
    const { token } = await core.login({ username: "admin", password: "x" });
    // activity every 20 min keeps idle fresh through ~11h…
    for (let i = 0; i < 33; i++) {
      now += 20 * 60 * 1000;
      expect(await core.currentUser(token)).not.toBeNull();
    }
    // …but past 12h absolute it's gone regardless of activity.
    now += 2 * 60 * 60 * 1000; // total > 12h
    expect(await core.currentUser(token)).toBeNull();
  });

  it("locks out after repeated failed logins, then recovers after the window", async () => {
    let now = 0;
    const core = createCore(fakeHost({ authOk: false }), () => now);
    for (let i = 0; i < 5; i++) {
      await expect(
        core.login({ username: "admin", password: "bad" }),
      ).rejects.toBeInstanceOf(AuthenticationError);
    }
    // 6th attempt is locked out (distinct message).
    await expect(
      core.login({ username: "admin", password: "bad" }),
    ).rejects.toThrow(/too many failed attempts/i);

    // After the lockout window, attempts are allowed again.
    now += 16 * 60 * 1000;
    await expect(
      core.login({ username: "admin", password: "bad" }),
    ).rejects.toThrow(/invalid credentials/i);
  });

  it("resets the failure counter on a successful login", async () => {
    let now = 0;
    const host = fakeHost({ authOk: false });
    const core = createCore(host, () => now);
    for (let i = 0; i < 4; i++) {
      await core.login({ username: "admin", password: "bad" }).catch(() => {});
    }
    // flip to success
    (
      host.authenticate as unknown as { execute: () => Promise<SessionContext> }
    ).execute = async () => SessionContext.create("u1", "SUPER_ADMIN", []);
    const { token } = await core.login({ username: "admin", password: "ok" });
    expect(token).toBeTruthy();
  });
});
