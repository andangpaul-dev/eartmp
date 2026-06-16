import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Same single source as vite.config.ts so UI tests rendering __APP_VERSION__
// (e.g. the AppShell footer) resolve it.
const pkg = JSON.parse(readFileSync(r("./package.json"), "utf8")) as {
  version: string;
};

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: {
      "@domain": r("./src/domain"),
      "@app": r("./src/application"),
      "@infra": r("./src/infrastructure"),
      "@ui": r("./src/presentation"),
    },
  },
  test: {
    globals: true,
    // Default env is node (domain/application/host tests need no DOM). UI tests
    // opt into jsdom per-file via `// @vitest-environment jsdom`.
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts"],
    setupFiles: ["tests/ui/setup.ts"],
    environmentOptions: { jsdom: { url: "http://localhost:1420" } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Coverage is gated over the layers that hold business logic: the domain +
      // application core (80% floor), plus the shell's testable host modules and
      // the runtime migration runner (a lower floor). The self-starting HTTP
      // entrypoint and DI wiring carry no unit-testable logic and are excluded.
      include: [
        "src/domain/**",
        "src/application/**",
        "src/host/**",
        "src/infrastructure/db/migrationRunner.ts",
      ],
      exclude: [
        "src/**/index.ts",
        "src/infrastructure/**",
        "src/presentation/**",
        // The self-starting HTTP entrypoint and the DI composition root have no
        // unit-testable logic (exercised via host smoke scripts instead).
        "src/host/server.ts",
        "src/host/composition.ts",
        // Ports are pure interfaces (type-only, erased at compile) — no
        // executable lines to cover.
        "src/application/ports/**",
        "**/*.d.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
        // Shell coverage floor — guards the host modules we now test (errors,
        // port resolution, file logging, dispatcher) and the migration runner
        // from silently regressing, without demanding the core's 80%.
        "src/host/**": {
          statements: 70,
          branches: 70,
          functions: 70,
          lines: 70,
        },
        "src/infrastructure/db/migrationRunner.ts": {
          statements: 70,
          branches: 70,
          functions: 70,
          lines: 70,
        },
      },
    },
  },
});
