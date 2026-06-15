/**
 * Host dispatcher (shell phase). Owns the session store, the login lifecycle,
 * and the single `dispatch(method, input, token)` entry the webview calls over
 * IPC. It resolves the token → SessionContext, runs the gated handler, and
 * returns a serializable `{ ok, data | error }` envelope. The webview never sees
 * a SessionContext or a thrown error — only the envelope.
 *
 * Hardening (Tier 1): sessions carry idle + absolute timeouts and are pruned on
 * access; repeated failed logins for a username are throttled with a temporary
 * lockout. Time is injected so both are unit-testable.
 */
import { randomUUID } from "node:crypto";
import { authorize } from "../application/authorization/AuthorizedUseCase";
import { AuthenticationError } from "../domain/errors/auth";
import { SessionContext } from "../domain/value-objects/SessionContext";
import type {
  Envelope,
  SessionView,
  LoginInput,
} from "../presentation/runtime/contract";
import { toCoreError } from "./errors";
import type { Host } from "./composition";

/** Session expires this long after last activity… */
const IDLE_MS = 30 * 60 * 1000; // 30 min
/** …or this long after login, whichever comes first. */
const ABSOLUTE_MS = 12 * 60 * 60 * 1000; // 12 h
/** Failed-login lockout: N failures within the window locks for the window. */
const LOCK_THRESHOLD = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000; // 15 min

interface SessionEntry {
  session: SessionContext;
  createdAt: number;
  lastSeenAt: number;
}
interface FailEntry {
  count: number;
  firstAt: number;
}

function toView(s: SessionContext): SessionView {
  return {
    userId: s.actorId,
    role: s.roleName,
    permissions: s.permissionList(),
  };
}

export interface Core {
  login(input: LoginInput): Promise<{ token: string; session: SessionView }>;
  logout(token: string): Promise<void>;
  currentUser(token: string | undefined): Promise<SessionView | null>;
  dispatch(
    method: string,
    input: unknown,
    token?: string,
  ): Promise<Envelope<unknown>>;
}

export function createCore(
  host: Host,
  now: () => number = () => Date.now(),
): Core {
  const sessions = new Map<string, SessionEntry>();
  const failures = new Map<string, FailEntry>();

  /** Resolve a token to a live session, pruning if expired. */
  function resolve(token: string | undefined): SessionContext | null {
    if (!token) return null;
    const e = sessions.get(token);
    if (!e) return null;
    const t = now();
    if (t - e.createdAt >= ABSOLUTE_MS || t - e.lastSeenAt >= IDLE_MS) {
      sessions.delete(token);
      return null;
    }
    e.lastSeenAt = t;
    return e.session;
  }

  function lockedOut(key: string): boolean {
    const f = failures.get(key);
    if (!f) return false;
    if (now() - f.firstAt >= LOCK_WINDOW_MS) {
      failures.delete(key); // window elapsed → reset
      return false;
    }
    return f.count >= LOCK_THRESHOLD;
  }

  function recordFailure(key: string): void {
    const t = now();
    const f = failures.get(key);
    if (!f || t - f.firstAt >= LOCK_WINDOW_MS) {
      failures.set(key, { count: 1, firstAt: t });
    } else {
      f.count += 1;
    }
  }

  return {
    async login(input) {
      const key = (input?.username ?? "").trim().toLowerCase();
      if (lockedOut(key)) {
        throw new AuthenticationError(
          "Too many failed attempts. Try again later.",
        );
      }
      try {
        // AuthenticateUser is public; the gate runs it with an anonymous session.
        const session = await authorize(
          host.authenticate,
          input as never,
          null,
        );
        failures.delete(key);
        const token = randomUUID();
        const t = now();
        sessions.set(token, { session, createdAt: t, lastSeenAt: t });
        return { token, session: toView(session) };
      } catch (e) {
        recordFailure(key);
        throw e;
      }
    },

    async logout(token) {
      sessions.delete(token);
    },

    async currentUser(token) {
      const s = resolve(token);
      return s ? toView(s) : null;
    },

    async dispatch(method, input, token) {
      const handler = host.registry.get(method);
      if (!handler) {
        return {
          ok: false,
          error: { code: "NOT_FOUND", message: `Unknown method "${method}".` },
        };
      }
      const session = resolve(token);
      try {
        const data = await handler(input, session);
        return { ok: true, data };
      } catch (e) {
        return { ok: false, error: toCoreError(e) };
      }
    },
  };
}
