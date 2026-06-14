/**
 * CoreProvider + session context (webview). Exposes the CoreApi via `useCore()`
 * and the authenticated session via `useSession()` — including `can(perm)`,
 * which the UI uses to hide/disable controls (fail-closed; the host re-checks).
 * The UI never asserts its own privileges; it only mirrors what the host grants.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CoreApi, SessionView } from "./contract";

interface SessionState {
  session: SessionView | null;
  setSession: (s: SessionView | null) => void;
  can: (permission: string) => boolean;
}

const CoreContext = createContext<CoreApi | null>(null);
const SessionCtx = createContext<SessionState | null>(null);

export function CoreProvider({
  client,
  children,
}: {
  client: CoreApi;
  children: ReactNode;
}) {
  const [session, setSession] = useState<SessionView | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    client
      .currentUser()
      .then((s) => alive && setSession(s))
      .catch(() => alive && setSession(null))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [client]);

  const can = useCallback(
    (permission: string) => session?.permissions.includes(permission) ?? false,
    [session],
  );

  const value = useMemo<SessionState>(
    () => ({ session, setSession, can }),
    [session, can],
  );

  if (!ready) {
    return <div className="splash">Loading…</div>;
  }

  return (
    <CoreContext.Provider value={client}>
      <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>
    </CoreContext.Provider>
  );
}

export function useCore(): CoreApi {
  const ctx = useContext(CoreContext);
  if (!ctx) throw new Error("useCore must be used within CoreProvider.");
  return ctx;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error("useSession must be used within CoreProvider.");
  return ctx;
}
