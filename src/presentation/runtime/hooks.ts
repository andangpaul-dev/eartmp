/**
 * Async hooks (webview). `useAsync` gives every read the four states the design
 * requires — loading / error / empty / data — plus reload. `useAction` runs a
 * mutation with loading + error + success callbacks. Errors are `CoreApiError`
 * (carrying `.code`), so screens can branch on CONFLICT / LOCKED / VALIDATION.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CoreApiError } from "./ipcClient";

export interface AsyncState<T> {
  loading: boolean;
  error: CoreApiError | null;
  data: T | null;
  reload: () => void;
}

export function useAsync<T>(
  fn: () => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<CoreApiError | null>(null);
  const [data, setData] = useState<T | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fnRef
      .current()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(asCoreError(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // deps are the caller's dependency list (intentional dynamic deps).
  }, deps);

  useEffect(run, [run]);

  return { loading, error, data, reload: run };
}

export interface ActionState {
  run: () => void;
  loading: boolean;
  error: CoreApiError | null;
}

export function useAction<T>(
  fn: () => Promise<T>,
  opts: {
    onSuccess?: (result: T) => void;
    onError?: (e: CoreApiError) => void;
  } = {},
): ActionState {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<CoreApiError | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(() => {
    setLoading(true);
    setError(null);
    fnRef
      .current()
      .then((r) => optsRef.current.onSuccess?.(r))
      .catch((e) => {
        const ce = asCoreError(e);
        setError(ce);
        optsRef.current.onError?.(ce);
      })
      .finally(() => setLoading(false));
  }, []);

  return { run, loading, error };
}

function asCoreError(e: unknown): CoreApiError {
  if (e instanceof CoreApiError) return e;
  return new CoreApiError({
    code: "INTERNAL",
    message: e instanceof Error ? e.message : "Unexpected error.",
  });
}
