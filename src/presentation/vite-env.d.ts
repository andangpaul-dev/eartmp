/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL for host RPC calls. Unset in dev (falls back to "/api" via the
   * Vite proxy); set to the sidecar's loopback URL in the packaged Tauri build.
   */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** App version, injected by Vite from the root package.json (single source). */
declare const __APP_VERSION__: string;
