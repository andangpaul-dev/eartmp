# Packaging runbook — EARTMP desktop (Tauri 2 + Node sidecar)

This turns the dev shell into an installable desktop app. The architecture is the
one chosen for the shell: a **Tauri 2** window hosting the React webview
(`dist-ui`), with the finished core running unchanged inside a **Node sidecar**
that the Rust shell launches and supervises.

> **Environment note.** The headless dev environment used to build the shell has
> **no Rust toolchain**, so the Tauri crate (`src-tauri/`) is _scaffolded and
> reviewed but not compiled here_. Everything that does not require Rust — the
> host bundle, the webview build, the wiring — is verified. Build the installer
> on a workstation with Rust + the platform toolchain.

## What's verified vs. what needs a toolchain

| Step                                                | Status                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| Host bundles to a single ESM file                   | ✅ `npm run bundle:host` → `dist-host/server.mjs` (~2.1 MB)        |
| Bundled host runs (login, RPC, gate, Prisma+Argon2) | ✅ ran on loopback; `listStudents` returned rows, anon → FORBIDDEN |
| Webview build + configurable API base               | ✅ `npm run ui:build`; `VITE_API_BASE` honoured                    |
| Tauri crate compiles / installer builds             | ⛔ needs Rust + platform toolchain (do on your workstation)        |
| PDF/DOCX export from the packaged sidecar           | ⚠️ validate after first build (see "Known validation points")      |

## Prerequisites (build workstation)

- Node 20+ and this repo's `npm ci`.
- **Rust** (stable) + platform build tools: MSVC Build Tools (Windows),
  Xcode CLT (macOS), `webkit2gtk`/`build-essential` (Linux).
- Tauri CLI: `npm i -D @tauri-apps/cli` (adds the `tauri` script already wired in
  `package.json`).

## How the sidecar is bundled (the hard part — solved)

`scripts/bundle-host.ts` esbuilds `src/host/server.ts` → `dist-host/server.mjs`
(ESM). Findings that shaped it:

- **ESM, not CJS** — the core's `PdfMakeRenderer` uses `import.meta.url`; CJS
  output breaks it.
- A **`createRequire` banner** is injected so esbuild's `__require` falls back to
  a real `require` for CJS deps that dynamically `require()` node builtins
  (`xlsx` → `stream`/`fs`, `pdfmake` fonts). Without it the bundle throws
  "Dynamic require of … is not supported" at runtime.
- **Native modules cannot be inlined** and stay external — they must ship in a
  pruned `node_modules` next to the bundle:
  - `@prisma/client` + the generated `.prisma/client` + the **query-engine
    binary** (`@prisma/engines`),
  - `@node-rs/argon2` + its per-platform `.node` package
    (e.g. `@node-rs/argon2-win32-x64-msvc`).

So the sidecar payload is: **Node runtime + `server.mjs` + a pruned production
`node_modules` (just the externals above)**. A single self-contained `.exe`
(SEA/pkg) is _not_ viable here because of Prisma's native query engine.

### Producing the sidecar binary

Tauri's `externalBin` expects a binary named with the target triple. Ship the
Node runtime as that binary and let Rust pass it `server.mjs`:

```
# from repo root, on the build workstation
npm run bundle:host
mkdir -p src-tauri/binaries
# copy the platform node into place, named for the target triple, e.g. Windows:
cp "$(command -v node)" "src-tauri/binaries/eartmp-node-x86_64-pc-windows-msvc.exe"
# prune a production node_modules holding only the externals, into dist-host/ :
#   @prisma/client, .prisma/client, @prisma/engines, @node-rs/argon2(+platform)
```

`tauri.conf.json` ships `dist-host/` (bundle + that pruned `node_modules`) and
`prisma/migrations/` as resources; `src-tauri/src/lib.rs` resolves
`host/server.mjs` from resources and spawns the sidecar on `EARTMP_HOST_PORT`
(5179), killing it on exit.

## Build

```
npm ci
npm run tauri build      # runs ui:build + bundle:host, then cargo build + bundler
```

Installers land in `src-tauri/target/release/bundle/` (msi/nsis, dmg, appimage/deb).

## Webview ↔ host wiring

- **Dev** (`npm run dev` / `tauri dev`): webview calls `/api`, Vite proxies to the
  host on 5179.
- **Packaged**: there is no proxy. Build the webview with
  `VITE_API_BASE=http://127.0.0.1:5179/api` so the webview calls the sidecar's
  loopback URL directly. The window CSP in `tauri.conf.json` already allows
  `connect-src http://127.0.0.1:5179`.

## Known validation points (do on first packaged build)

1. **PDF/DOCX export** — confirm transcript export works from the packaged
   sidecar (the `import.meta.url` font-loading path). It works in-process and in
   the bundled host smoke; validate end-to-end in the installed app.
2. **Prisma query-engine path** — confirm the engine binary resolves from the
   shipped `node_modules` (set `PRISMA_QUERY_ENGINE_LIBRARY` if Prisma can't find
   it under packaging).
3. **DB location & migrations** — point `DATABASE_URL` at a per-user app-data path
   and apply `prisma/migrations` on first launch (see ADR-008 / the encryption
   runbook). The dev build uses the repo-local SQLite file.
4. **Port contention** — 5179 is fixed; if taken, the sidecar fails to bind. A
   follow-up can negotiate a free port and pass it to the webview at runtime.

## Files

- `scripts/bundle-host.ts` — esbuild the host (verified).
- `src-tauri/tauri.conf.json` — window, CSP, resources, sidecar.
- `src-tauri/src/lib.rs` — sidecar supervisor (spawn + kill-on-exit).
- `src-tauri/Cargo.toml`, `build.rs`, `src/main.rs`, `capabilities/default.json`.
