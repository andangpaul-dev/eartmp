# Auto-update & release runbook

EARTMP ships a built-in self-updater (Tauri updater plugin). An installed app
checks **Help → Diagnostics → Check for updates**, which reads a signed
`latest.json` from the **public** GitHub Releases of `andangpaul-dev/eartmp` and,
if a newer version exists, downloads + installs it and relaunches.

> Code signing (Authenticode) is **not** configured — installers are unsigned, so
> first-time installs still show a Windows SmartScreen "unknown publisher"
> warning. The update **artifacts** are signed with a separate updater key
> (minisign), which is what makes auto-update safe.

## One-time setup

1. **Updater keypair** — already generated at `~/.tauri/eartmp-updater.key`
   (public half is in `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`).
   Keep the private key secret and backed up; losing it breaks updates for all
   installs (they only trust artifacts signed by it).
2. **Repo secrets** (Settings → Secrets and variables → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY` — the **contents** of `eartmp-updater.key`.
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — empty (the key was generated without
     a password) unless you set one.
3. The repo is **public** so the updater can fetch releases without a token.

## Cutting a release

1. Bump the product version in **`package.json`** (`version`) — this is the
   single source the bundle + updater compare against.
2. Commit, then tag and push:
   ```bash
   git tag v0.1.1
   git push origin v0.1.1
   ```
3. The **`release`** workflow (`.github/workflows/release.yml`) builds the
   production app on `windows-latest`, signs the updater artifacts, creates the
   GitHub Release `v0.1.1`, and uploads the installers + `latest.json`.
4. Installed apps now see the update on their next **Check for updates**.

## Notes / first-run tuning

- The build runs `beforeBuildCommand` (`ui:build` + `assemble:sidecar`). The
  sidecar step stages a Node runtime as the bundled host binary; on CI it uses
  the runner's Node. If the first CI build can't locate it, adjust
  `scripts/assemble-sidecar.ts`'s node-path resolution.
- To test end to end: publish `v0.1.1` while running an installed `v0.1.0`, then
  Check for updates.
- Production builds use `--no-default-features` (no UAT sample data); the
  workflow already passes this.
