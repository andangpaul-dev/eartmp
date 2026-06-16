# EARTMP — Code Signing & Auto-Update (release scaffold)

This document is the production-signing runbook for the desktop shell. The
default `src-tauri/tauri.conf.json` produces **unsigned** dev/test builds (no
certs required). Signing and auto-update are layered in for release via the
overlay `src-tauri/tauri.conf.release.json`, merged with `--config`:

```bash
# production build: real adapters (no `uat`), signed, with update artifacts
npm run tauri build -- --no-default-features --config src-tauri/tauri.conf.release.json
```

Nothing here changes the unsigned local build — the overlay is opt-in.

---

## 1. Windows — Authenticode

Tauri's Windows bundler signs `.msi`/`.exe` when given a certificate thumbprint.
No Rust plugin is involved; it shells out to `signtool`.

1. Obtain an EV or OV code-signing certificate (DigiCert, Sectigo, …). For EV,
   the private key lives on a hardware token / HSM; install the cert into the
   Windows certificate store on the build machine.
2. Find its thumbprint:
   ```powershell
   Get-ChildItem Cert:\CurrentUser\My | Format-List Subject, Thumbprint
   ```
3. Put the thumbprint in `tauri.conf.release.json` →
   `bundle.windows.certificateThumbprint` (or inject it in CI before the build).
   `timestampUrl` is already set to an RFC-3161 timestamp server so signatures
   stay valid after the certificate expires; `digestAlgorithm` is `sha256`.
4. Build with the overlay (command above). Verify:
   ```powershell
   signtool verify /pa /v "src-tauri\target\release\bundle\msi\EARTMP_*.msi"
   ```

**Never commit the certificate, its password, or the thumbprint of a private
build cert.** Treat the thumbprint as a CI secret.

## 2. macOS — Developer ID + notarization

1. Apple Developer ID Application certificate installed in the login keychain.
2. Set CI secrets and build:
   ```bash
   export APPLE_CERTIFICATE="<base64 .p12>"
   export APPLE_CERTIFICATE_PASSWORD="…"
   export APPLE_SIGNING_IDENTITY="Developer ID Application: … (TEAMID)"
   export APPLE_ID="…"; export APPLE_PASSWORD="<app-specific>"; export APPLE_TEAM_ID="…"
   npm run tauri build -- --no-default-features --config src-tauri/tauri.conf.release.json
   ```
   Tauri signs and submits for notarization, then staples the ticket.

## 3. Auto-updater

The overlay carries the `plugins.updater` config, but the updater also needs the
Rust plugin compiled in and a capability granted. Enable it once, then ship
signed update artifacts each release.

### One-time enablement

1. Add the crates (in `src-tauri/`):
   ```bash
   cargo add tauri-plugin-updater
   cargo add tauri-plugin-process   # for relaunch-after-update
   ```
2. Register in `src-tauri/src/lib.rs`:
   ```rust
   .plugin(tauri_plugin_updater::Builder::new().build())
   .plugin(tauri_plugin_process::init())
   ```
3. Add the JS bindings: `npm i @tauri-apps/plugin-updater @tauri-apps/plugin-process`.
4. Grant the capability in `src-tauri/capabilities/default.json`:
   `"updater:default"`, `"process:allow-restart"`.
5. Generate the signing keypair (asymmetric; separate from the OS code-signing
   cert):
   ```bash
   npm run tauri signer generate -- -w "$HOME/.eartmp/updater.key"
   ```

   - Put the **public** key in `tauri.conf.release.json` → `plugins.updater.pubkey`.
   - Keep the **private** key + its password as CI secrets:
     `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
6. Point `plugins.updater.endpoints` at the real release host. The
   `{{target}}/{{arch}}/{{current_version}}` template lets the server decide
   whether an update applies.

### Per-release

- `createUpdaterArtifacts: true` (set in the overlay) makes the build emit the
  update bundle plus a `.sig`. Publish both, alongside a `latest.json` manifest
  the endpoint serves.
- The app checks for updates on launch (or on demand) and only installs a bundle
  whose signature verifies against the embedded `pubkey` — a malicious mirror
  can't push an unsigned or tampered update.

### Offline-first note

EARTMP is offline-first; the updater must **fail open** — a missing/unreachable
endpoint is a no-op, never a launch blocker. Gate the check so air-gapped
installs simply never see updates.

---

## Checklist (add to release-checklist.md when the shell ships)

- [ ] Windows `.msi`/`.exe` Authenticode-signed and timestamped; `signtool verify` passes.
- [ ] macOS bundle Developer-ID signed, notarized, stapled.
- [ ] Updater keypair generated; public key in overlay, private key only in CI secrets.
- [ ] `latest.json` + signed artifacts published to the release endpoint.
- [ ] Update check verified against a real prior version; signature-mismatch rejected.
- [ ] Updater fails open when the endpoint is unreachable (offline-first).
