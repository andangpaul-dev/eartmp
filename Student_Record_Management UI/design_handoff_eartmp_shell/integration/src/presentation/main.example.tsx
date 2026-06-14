/**
 * EARTMP — Webview composition root (the ONLY place wiring is chosen)
 * ============================================================================
 * Target: `src/presentation/main.tsx`
 *
 * The webview side is thin: build the IPC client (one Tauri command bridge),
 * hydrate the session via currentUser(), mount React. The trusted host wiring
 * (DI container + dispatcher + authorize) lives in src/host/dispatcher.ts.
 */

import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CoreProvider } from "./runtime/react";
import { createIpcClient } from "./runtime/ipcClient";
import type { CoreApi, CoreMethod, SessionView } from "./runtime/contract";

async function bootstrap() {
  /* ── 1. Build the IPC bridge → CoreApi ─────────────────────────── */
  const { invoke } = await import("@tauri-apps/api/core");
  const bridge = (method: CoreMethod, input: unknown) =>
    invoke("execute_use_case", { method, input }) as Promise<{
      ok: boolean;
      data?: unknown;
      error?: { code: string; message: string };
    }>;
  const core: CoreApi = createIpcClient(bridge as never);

  /* ── 2. Hydrate session (host owns it; returns null if logged out) ─ */
  let initialSession: SessionView | null = null;
  try {
    initialSession = await core.currentUser();
  } catch {
    initialSession = null;
  }

  /* ── 3. Mount. Login sets the session via useLogin(). ──────────── */
  const Root = () => {
    const [ready, setReady] = useState(false);
    useEffect(() => {
      setReady(true);
    }, []);
    if (!ready) return null;
    return (
      <CoreProvider core={core} initialSession={initialSession}>
        {/* <App /> — render <LoginScreen/> when session is null, else the shell. */}
        <div style={{ padding: 24, fontFamily: "IBM Plex Sans, sans-serif" }}>
          Wire &lt;App /&gt; here — see screens/StudentsScreen.tsx for the
          pattern.
        </div>
      </CoreProvider>
    );
  };

  createRoot(document.getElementById("root")!).render(<Root />);
}

bootstrap();
