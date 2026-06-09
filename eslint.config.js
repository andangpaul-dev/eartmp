// Flat ESLint config (ESLint 9). Enforces TypeScript rules and — most
// importantly — the Clean Architecture dependency rule via import boundaries.
//
// Dependency rule (inward only):
//   presentation -> application -> domain
//   infrastructure implements domain/application ports (wired at the DI root)
// A file in an inner layer may NOT import an outer layer, and the domain +
// application layers may NOT import framework code (React / Prisma / Tauri).

import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";

const FRAMEWORK_IMPORTS = [
  { name: "react", message: "Inner layers must not import React." },
  { name: "react-dom", message: "Inner layers must not import React DOM." },
  {
    name: "@prisma/client",
    message: "Inner layers must not import Prisma. Depend on repository ports.",
  },
];
const FRAMEWORK_PATTERNS = ["@tauri-apps/*", "@prisma/*"];

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "reference-implementation/**",
      "coverage/**",
      "**/*.d.ts",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tseslint, import: importPlugin },
    settings: {
      "import/resolver": {
        typescript: { project: "./tsconfig.json" },
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "import/order": [
        "warn",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
          ],
          "newlines-between": "never",
        },
      ],
      // The architectural boundary: inner layers cannot import outer layers.
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            { target: "src/domain", from: "src/application" },
            { target: "src/domain", from: "src/infrastructure" },
            { target: "src/domain", from: "src/presentation" },
            { target: "src/application", from: "src/infrastructure" },
            { target: "src/application", from: "src/presentation" },
            // UI must not reach the database/repositories directly.
            { target: "src/presentation", from: "src/infrastructure" },
          ],
        },
      ],
    },
  },
  // Domain + application may not import framework code at all.
  {
    files: ["src/domain/**/*.ts", "src/application/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: FRAMEWORK_IMPORTS, patterns: FRAMEWORK_PATTERNS },
      ],
    },
  },
];
