/**
 * EARTMP — HOST dispatcher (runs in the trusted Tauri/Node host, NOT webview)
 * ============================================================================
 * Target: `src/host/dispatcher.ts`
 *
 * The trusted side. It MAY import infrastructure + the DI container (the
 * webview may not). It owns the live SessionContext per window and is the
 * single place use-cases execute — always through the real `authorize()`
 * gate (fail-closed; F-16: identity from the session, never the caller).
 *
 * Wire ONE Tauri command to `dispatch(method, input)` and return its
 * { ok, data | error } envelope to the webview unchanged.
 */

import { CoreMethod, USE_CASE } from "../presentation/runtime/contract";
import {
  toErrorEnvelope,
  type CoreErrorEnvelope,
} from "../presentation/runtime/errors";
import type { SessionView } from "../presentation/runtime/contract";

// ── Real core imports (HOST-only). Adjust alias to your tsconfig. ─────────
// import { buildContainer, type Container } from "../infrastructure/di/container";
// import { authorize, type AuthorizedUseCase } from "../application/authorization/AuthorizedUseCase";
// import { SessionContext } from "../domain/value-objects/SessionContext";

// Structural stand-ins so this scaffold type-checks standalone.
// DELETE and use the real imports above once in the repo.
type SessionContext = {
  actorId: string;
  roleName: string;
  isAnonymous: boolean;
  permissionList(): string[];
};
interface AuthorizedUseCase<I, O> {
  readonly name: string;
  readonly requiredPermissions: string[];
  readonly isPublic?: boolean;
  readonly authenticatedOnly?: boolean;
  execute(input: I, session: SessionContext): Promise<O>;
}
declare function authorize<I, O>(
  uc: AuthorizedUseCase<I, O>,
  input: I,
  session: SessionContext | null,
): Promise<O>;
interface Container {
  resolve<T>(token: string): T;
}

/* ─────────────────── Session store (per host process) ────────────────── */

export interface HostSession {
  get(): SessionContext | null;
  set(s: SessionContext | null): void;
}

export function createMemorySession(): HostSession {
  let cur: SessionContext | null = null;
  return {
    get: () => cur,
    set: (s) => {
      cur = s;
    },
  };
}

/** Project SessionContext → the read-only view the webview renders. */
export function toSessionView(
  s: SessionContext,
  extra?: Pick<SessionView, "fullName" | "mustChangePassword" | "keyUnlocked">,
): SessionView {
  return {
    actorId: s.actorId,
    roleName: s.roleName,
    permissions: s.permissionList(),
    ...extra,
  };
}

/* ──────────────────────────── Dispatcher ─────────────────────────────── */

export interface DispatchOk {
  ok: true;
  data: unknown;
}
export interface DispatchErr {
  ok: false;
  error: CoreErrorEnvelope;
}
export type DispatchResult = DispatchOk | DispatchErr;

/**
 * Resolve the use-case for `method` from the container and run it through
 * `authorize()` with the live session. Returns a serializable envelope the
 * Tauri command hands straight back to the webview.
 *
 * Container token convention: the use-case class `.name` (USE_CASE[m].name).
 * ⚠ RECONCILE with how you register providers in `buildContainer()`.
 */
export function createDispatcher(deps: {
  container: Container;
  session: HostSession;
}) {
  const { container, session } = deps;

  return async function dispatch(
    method: CoreMethod,
    input: unknown,
  ): Promise<DispatchResult> {
    try {
      const entry = USE_CASE[method];
      if (!entry) throw new Error(`Unknown method "${method}".`);

      // Session-lifecycle methods the host owns directly:
      if (method === "login") {
        const uc = container.resolve<
          AuthorizedUseCase<unknown, SessionContext>
        >(entry.name);
        const ctx = await authorize(uc, input, session.get()); // AuthenticateUser.isPublic
        session.set(ctx);
        return { ok: true, data: toSessionView(ctx) };
      }
      if (method === "logout") {
        session.set(null);
        return { ok: true, data: undefined };
      }
      if (method === "currentUser") {
        const s = session.get();
        return {
          ok: true,
          data: s && !s.isAnonymous ? toSessionView(s) : null,
        };
      }
      // unlockSigningKey: ⚠ confirm whether this is an authorized use-case
      // (ChangeKeyPassphrase) or a host security-port op that unseals the key
      // for the session. Handle here accordingly; it likely also flips a
      // `keyUnlocked` flag echoed via toSessionView on the next currentUser.

      // All other methods: resolve → authorize → execute.
      const uc = container.resolve<AuthorizedUseCase<unknown, unknown>>(
        entry.name,
      );
      const data = await authorize(uc, input ?? {}, session.get());
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: toErrorEnvelope(e) };
    }
  };
}

/* ─────────────────────────── Tauri wiring ────────────────────────────── *
 * Register ONE command that forwards to dispatch:
 *
 *   const dispatch = createDispatcher({ container: buildContainer(), session });
 *   // command "execute_use_case":
 *   async ({ method, input }) => dispatch(method as CoreMethod, input)
 *
 * If the host is Rust, expose an equivalent execute_use_case(method, input)
 * that calls the TS core and returns the SAME { ok, data | error } envelope —
 * then the webview client (ipcClient.ts) needs no change.
 */
