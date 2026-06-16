import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Single source of truth for the app version: the root package.json. The webview
// reads it via __APP_VERSION__; the Tauri bundle reads the same file through
// tauri.conf.json (`version: "../package.json"`).
const pkg = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./package.json", import.meta.url)),
    "utf8",
  ),
) as { version: string };

// Dev webview (shell phase). The webview is a pure browser bundle; it reaches the
// Node host over `/api`, which Vite proxies to the host server (run with
// `npm run host:serve`). Build output goes to `dist-ui` so it never clashes with
// the core's `dist` (tsc declarations).
export default defineConfig({
  plugins: [react()],
  root: ".",
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { outDir: "dist-ui", emptyOutDir: true },
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.EARTMP_HOST_PORT ?? 5179}`,
        changeOrigin: true,
      },
    },
  },
});
