/**
 * EARTMP — React runtime: session, useCore, useAsync, useAction, can()
 * ============================================================================
 * Target: `src/presentation/runtime/react.tsx`
 *
 * Wrap the app once in <CoreProvider core={ipcClient}>, then in any screen:
 *
 *   const core = useCore();                       // typed CoreApi
 *   const { session, can } = useSession();        // SessionView + gating
 *   const list = useAsync(() => core.listStudents({ where: f }), [f]);
 *
 * No screen imports the host, infrastructure, or invoke — only useCore().
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CoreApi, SessionView } from "./contract";
import { CoreError } from "./errors";

/* ─────────────────────────── Context ─────────────────────────────── */

interface CoreCtxValue {
  core: CoreApi;
  session: SessionView | null;
  setSession: (s: SessionView | null) => void;
}
const CoreCtx = createContext<CoreCtxValue | null>(null);

export function CoreProvider({
  core,
  initialSession = null,
  children,
}: {
  core: CoreApi;
  initialSession?: SessionView | null;
  children: React.ReactNode;
}) {
  const [session, setSession] = useState<SessionView | null>(initialSession);
  const value = useMemo(() => ({ core, session, setSession }), [core, session]);
  return <CoreCtx.Provider value={value}>{children}</CoreCtx.Provider>;
}

function useCoreCtx(): CoreCtxValue {
  const v = useContext(CoreCtx);
  if (!v) throw new Error("useCore/useSession must be inside <CoreProvider>.");
  return v;
}

/** The typed CoreApi façade. */
export function useCore(): CoreApi {
  return useCoreCtx().core;
}

/** Session + fail-closed permission helpers (reads SessionView.permissions). */
export function useSession() {
  const { session, setSession } = useCoreCtx();
  const can = useCallback(
    (perm: string) => !!session && session.permissions.includes(perm),
    [session],
  );
  const canAll = useCallback(
    (perms: string[]) =>
      !!session && perms.every((p) => session.permissions.includes(p)),
    [session],
  );
  return { session, setSession, can, canAll };
}

/**
 * Convenience: run login and store the resulting session in one call.
 *   const login = useLogin();
 *   await login({ username, password });   // sets session on success
 */
export function useLogin() {
  const { core, setSession } = useCoreCtx();
  return useCallback(
    async (input: Parameters<CoreApi["login"]>[0]) => {
      const s = await core.login(input);
      setSession(s);
      return s;
    },
    [core, setSession],
  );
}

export function useLogout() {
  const { core, setSession } = useCoreCtx();
  return useCallback(async () => {
    await core.logout();
    setSession(null);
  }, [core, setSession]);
}

/* ───────────────────── useAsync (reads) ──────────────────────────── */

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: CoreError | null;
  reload: () => void;
}

export function useAsync<T>(
  loader: () => Promise<T>,
  deps: React.DependencyList,
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<CoreError | null>(null);
  const reqId = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const run = useCallback(() => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    loaderRef
      .current()
      .then((res) => {
        if (id === reqId.current) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (id === reqId.current) {
          setError(
            e instanceof CoreError ? e : new CoreError("UNKNOWN", String(e)),
          );
          setLoading(false);
        }
      });
  }, []);

  useEffect(() => {
    run();
    return () => {
      reqId.current++; // invalidate in-flight on dep change / unmount
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, reload: run };
}

/* ───────────────────── useAction (mutations) ─────────────────────── */

export interface ActionState {
  run: () => void;
  pending: boolean;
  error: CoreError | null;
}

export function useAction<T>(
  fn: () => Promise<T>,
  opts?: { onSuccess?: (r: T) => void; onError?: (e: CoreError) => void },
): ActionState {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<CoreError | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const run = useCallback(() => {
    setPending(true);
    setError(null);
    fnRef
      .current()
      .then((r) => {
        setPending(false);
        optsRef.current?.onSuccess?.(r);
      })
      .catch((e) => {
        const ce =
          e instanceof CoreError ? e : new CoreError("UNKNOWN", String(e));
        setPending(false);
        setError(ce);
        optsRef.current?.onError?.(ce);
      });
  }, []);

  return { run, pending, error };
}

/* ─────────────────── PermissionGate (fail-closed) ────────────────── */

export function PermissionGate({
  perm,
  fallback = null,
  children,
}: {
  perm: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { can } = useSession();
  return <>{can(perm) ? children : fallback}</>;
}
