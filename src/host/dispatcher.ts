/**
 * Host dispatcher (shell phase). Owns the session store, the login lifecycle,
 * and the single `dispatch(method, input, token)` entry the webview calls over
 * IPC. It resolves the token → SessionContext, runs the gated handler, and
 * returns a serializable `{ ok, data | error }` envelope. The webview never sees
 * a SessionContext or a thrown error — only the envelope.
 */
import { randomUUID } from "node:crypto";
import { authorize } from "../application/authorization/AuthorizedUseCase";
import { SessionContext } from "../domain/value-objects/SessionContext";
import type {
  Envelope,
  SessionView,
  LoginInput,
} from "../presentation/runtime/contract";
import { toCoreError } from "./errors";
import type { Host } from "./composition";

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

export function createCore(host: Host): Core {
  const sessions = new Map<string, SessionContext>();

  return {
    async login(input) {
      // AuthenticateUser is public; the gate runs it with an anonymous session
      // and returns the authenticated SessionContext.
      const session = await authorize(host.authenticate, input as never, null);
      const token = randomUUID();
      sessions.set(token, session);
      return { token, session: toView(session) };
    },

    async logout(token) {
      sessions.delete(token);
    },

    async currentUser(token) {
      const s = token ? sessions.get(token) : undefined;
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
      const session = token ? (sessions.get(token) ?? null) : null;
      try {
        const data = await handler(input, session);
        return { ok: true, data };
      } catch (e) {
        return { ok: false, error: toCoreError(e) };
      }
    },
  };
}
