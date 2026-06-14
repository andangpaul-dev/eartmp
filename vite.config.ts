import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev webview (shell phase). The webview is a pure browser bundle; it reaches the
// Node host over `/api`, which Vite proxies to the host server (run with
// `npm run host:serve`). Build output goes to `dist-ui` so it never clashes with
// the core's `dist` (tsc declarations).
export default defineConfig({
  plugins: [react()],
  root: ".",
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
