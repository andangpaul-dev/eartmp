import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
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
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Coverage is gated over the layers that hold business logic in Phase 1.
      // Infrastructure scaffolding, the DI composition root, the seed script and
      // the presentation placeholder carry no logic yet and are intentionally
      // excluded until the phases that build them (P2+) add their own tests.
      include: ["src/domain/**", "src/application/**"],
      exclude: [
        "src/**/index.ts",
        "src/infrastructure/**",
        "src/presentation/**",
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
      },
    },
  },
});
