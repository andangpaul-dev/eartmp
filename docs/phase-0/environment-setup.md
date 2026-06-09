# Development Environment Setup Guide

**Project:** EARTMP · **Phase:** 0 · **Status:** Draft, awaiting approval

How to stand up a working EARTMP development environment. The current repo is a
**domain-core slice** (TypeScript + Vitest + Prisma schema); the full Tauri/React
shell is added in later phases. This guide covers both the present state and the
target full setup.

---

## 1. Prerequisites

| Tool                      | Version         | Notes                                                                          |
| ------------------------- | --------------- | ------------------------------------------------------------------------------ |
| **Node.js**               | ≥ 20 LTS        | ESM, modern TS.                                                                |
| **npm**                   | ≥ 10            | (or pnpm — pick one and commit the lockfile).                                  |
| **Git**                   | any recent      | the repo is not yet `git init`'d — initialise before Phase 1.                  |
| **Rust toolchain**        | stable (rustup) | required by **Tauri** (later phase).                                           |
| **Tauri 2 prerequisites** | per OS          | Windows: WebView2 + MSVC Build Tools; macOS: Xcode CLT; Linux: webkit2gtk etc. |
| **SQLite**                | bundled         | Prisma ships the engine; no separate install needed.                           |
| **VS Code** (recommended) | —               | with ESLint, Prettier, Prisma extensions.                                      |

> **Platform note (this machine):** Windows 10 + PowerShell. Use PowerShell
> syntax (`$env:VAR`, not `export`). All npm scripts below run identically.

---

## 2. Current repo: run the domain core

The present `package.json` exposes the core engine workflow:

```powershell
npm install
npm run typecheck   # tsc --noEmit, strict + noUncheckedIndexedAccess
npm test            # vitest run (16 passing tests in the reference slice)
```

What this validates: the configurable engines (`GradeScale`,
`AssessmentStructure`, `GpaEngine`), entities, repository ports, and the
`ProcessSemesterResults` use-case — all running **with no DB and no React**,
which is the architecture proof.

> `reference-implementation/` has its own `package.json`/`tsconfig.json` and can
> be run the same way inside that folder. It is reference material, not part of
> the app build.

---

## 3. Environment variables

`.env` at repo root:

```
DATABASE_URL="file:./dev.db"
```

- Dev uses a local file DB. Production resolves to a per-OS app-data path
  (managed by the Tauri shell in a later phase).
- Never commit real institution data or secrets. `.env` stays out of any export.

---

## 4. Database / Prisma workflow

```powershell
# Generate the typed client (needs network to Prisma's binary host the FIRST time)
npx prisma generate

# Create + apply a migration and (re)generate the client
npx prisma migrate dev --name init

# Inspect data
npx prisma studio
```

> **Known constraint (R-3):** `prisma generate`/`migrate` download a query-engine
> binary from Prisma's host. In an offline/sandboxed environment this is blocked.
> Mitigations: run generation once in a connected environment and cache
> `node_modules/.prisma` + the engine binaries; configure
> `PRISMA_ENGINES_MIRROR`/offline cache for CI. The schema is structurally valid
> (23 models, balanced, soft-delete present) and can be reviewed without
> generation.

Seeding (Phase 1+): `npx prisma db seed` provisions default roles/permissions, a
default `GradeScale`, `AssessmentConfig`, Transcript Template V1, and the
`Institution` row.

---

## 5. Target full-stack setup (later phases)

When the Tauri + React shell is introduced:

```powershell
# Install JS deps (adds React 19, Vite, Tailwind, ShadCN, TanStack Query, RHF, Zod,
# SheetJS, pdfmake, docx, argon2, qrcode, @tauri-apps/*)
npm install

# Run the web UI in dev (Vite)
npm run dev

# Run the desktop app in dev (Tauri wraps the Vite dev server)
npm run tauri dev

# Production desktop build
npm run tauri build
```

`src-tauri/` (Rust shell) is scaffolded with `npm create tauri-app` conventions:
`tauri.conf.json` (with a **minimal capability allowlist** per
[security-architecture.md](security-architecture.md) §8), `Cargo.toml`, and the
Rust command surface.

---

## 6. Toolchain config to add in Phase 1

| File                             | Purpose                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `.eslintrc` / `eslint.config.js` | `@typescript-eslint`, import-order, **layer-boundary rules**, React/hooks.    |
| `.prettierrc`                    | 2-space, double quotes, semicolons, trailing commas (matches reference code). |
| `vitest.config.ts`               | test env, coverage thresholds (**≥ 80%**), path aliases.                      |
| `tsconfig.json`                  | strict family flags; path aliases `@domain/*`, `@app/*`, etc.                 |
| `.husky/` + lint-staged          | pre-commit: Prettier + ESLint on staged files.                                |
| CI workflow                      | `prettier --check` → `eslint` → `tsc --noEmit` → `vitest run --coverage`.     |

---

## 7. Recommended VS Code settings

- Format on save (Prettier as default formatter).
- ESLint auto-fix on save.
- Prisma extension for schema syntax/format.
- Vitest extension for inline test runs.

---

## 8. Verification checklist (a fresh clone should pass)

- [ ] `npm install` succeeds.
- [ ] `npm run typecheck` is clean (strict).
- [ ] `npm test` passes (engine + use-case tests, no DB).
- [ ] `npx prisma validate` passes (in a connected env, `generate` succeeds).
- [ ] (full setup) `npm run tauri dev` launches the desktop shell.

---

## 9. Troubleshooting

| Symptom                          | Cause                               | Fix                                                                       |
| -------------------------------- | ----------------------------------- | ------------------------------------------------------------------------- |
| `prisma generate` hangs/fails    | offline; binary host blocked (R-3)  | run once online; cache engines; set offline mirror.                       |
| Tauri build fails on Windows     | missing WebView2 / MSVC Build Tools | install VS Build Tools + WebView2 runtime.                                |
| `tsc` errors on index access     | `noUncheckedIndexedAccess`          | use non-null assertions/guards as the reference code does (`sorted[i]!`). |
| Vitest can't resolve `@domain/*` | missing path alias                  | add aliases to `vitest.config.ts` and `tsconfig.json`.                    |

_Related: [solution-architecture.md](solution-architecture.md) ·
[database-design.md](database-design.md) ·
[implementation-plan.md](implementation-plan.md)_
