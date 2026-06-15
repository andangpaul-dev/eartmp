/**
 * Async hooks (webview). `useAsync` gives every read the four states the design
 * requires — loading / error / empty / data — plus reload, with a request
 * sequence guard so a slow earlier request can't overwrite a newer one.
 * `useAction` runs a mutation with loading + error + a one-shot `success` flag,
 * and refuses re-entry while in flight (no double-submit on irreversible,
 * audited mutations). Errors are `CoreApiError` (carrying `.code`).
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
  // Monotonic request id — only the latest run is allowed to write state.
  const seq = useRef(0);

  const run = useCallback(() => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    fnRef
      .current()
      .then((d) => {
        if (id === seq.current) setData(d);
      })
      .catch((e) => {
        if (id === seq.current) setError(asCoreError(e));
      })
      .finally(() => {
        if (id === seq.current) setLoading(false);
      });
    return () => {
      // Invalidate this run so a late resolution is ignored.
      if (id === seq.current) seq.current++;
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
  success: boolean;
  reset: () => void;
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
  const [success, setSuccess] = useState(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const inFlight = useRef(false);

  const run = useCallback(() => {
    if (inFlight.current) return; // re-entry guard: no double-submit
    inFlight.current = true;
    setLoading(true);
    setError(null);
    setSuccess(false);
    fnRef
      .current()
      .then((r) => {
        setSuccess(true);
        optsRef.current.onSuccess?.(r);
      })
      .catch((e) => {
        const ce = asCoreError(e);
        setError(ce);
        optsRef.current.onError?.(ce);
      })
      .finally(() => {
        inFlight.current = false;
        setLoading(false);
      });
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setSuccess(false);
  }, []);

  return { run, loading, error, success, reset };
}

function asCoreError(e: unknown): CoreApiError {
  if (e instanceof CoreApiError) return e;
  return new CoreApiError({
    code: "INTERNAL",
    message: e instanceof Error ? e.message : "Unexpected error.",
  });
}
