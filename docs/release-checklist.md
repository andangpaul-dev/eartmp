# EARTMP — Release Checklist (Headless Core)

"Release-ready (headless core)" = every box below checked. **Note:** a runnable
desktop product additionally requires the **shell phase** (Tauri + React UI + the
Tauri-SQL runtime replacing the dev Prisma adapters). This checklist certifies the
domain/application core, not a packaged app.

---

## Quality gate

- [ ] `npm run typecheck` — clean (tsc strict).
- [ ] `npm run lint` — 0 errors (incl. Clean-Architecture import boundaries).
- [ ] `npm run format:check` — conforms.
- [ ] `npm run test:coverage` — all tests pass; coverage ≥80% on `domain` + `application`.
- [ ] `tests/architecture.test.ts` (boundary fitness) — green.

## Data & migrations

- [ ] `npx prisma migrate deploy` applies cleanly to a fresh DB.
- [ ] `npm run db:seed` is idempotent (re-running adds nothing).
- [ ] Partial-unique indexes on user-facing codes present (soft-delete safe).

## Security

- [ ] Admin default password is changed (not `ChangeMe123!`).
- [ ] `EARTMP_KEY_PASSPHRASE` set to a real secret (not the dev default).
- [ ] Transcript signing private key is **sealed** at rest (no plaintext secret in `Setting`).
- [ ] No secrets in logs or the audit trail (redaction verified).
- [ ] `.env` / `*.db` are gitignored and never committed.
- [ ] DB-at-rest (SQLCipher, ADR-008) wiring scheduled for the shell.

## Integrity & recovery

- [ ] `npm run demo:backup` — backup encrypts; tamper + wrong passphrase rejected.
- [ ] Restore is verify-first + atomic (no partial writes) — covered by tests.
- [ ] `npm run demo:audit` — chain verifies; a tampered row is pinpointed.

## End-to-end

- [ ] `npm run demo:e2e` — the full pipeline runs GREEN (admit → results → CGPA →
      transcript sign/verify → PDF → graduate → backup → audit-verify).
- [ ] Every per-capability demo (§4 of the runbook) passes.

## Docs

- [ ] `/docs` updated: every phase has `README` + `implementation-notes`.
- [ ] `docs/runbook.md` + this checklist current.
- [ ] CLAUDE.md "Current status" reflects completion.

---

## Packaging the desktop installer (Tauri shell)

> **⚠️ Build the PRODUCTION variant for any real install. The default build is a
> UAT build that CANNOT open a production database.**

The Tauri shell (`src-tauri/src/lib.rs`) has a `uat` cargo feature that is **on by
default**. It controls how the sidecar host opens the encrypted DB:

| Build             | Command                                           | Behaviour                                                                                                                                                                        |
| ----------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Production**    | `npm run tauri -- build -- --no-default-features` | Sets `EARTMP_REQUIRE_UNLOCK=1`: the app starts **locked** and prompts the operator for their passphrase on the unlock screen. No demo data. **Use this for every real install.** |
| **UAT / testing** | `npm run tauri build` (default features)          | Sets `EARTMP_SEED_DEMO=1` + `EARTMP_DB_PASSPHRASE="eartmp-dev-passphrase"`: seeds sample data and **auto-unlocks** with the dev passphrase. For throwaway test DBs only.         |

**Why it matters:** a UAT build run against a database that was created by a
production build (i.e. encrypted with the operator's own passphrase) fails to
decrypt — `host.log` shows `SQLITE_NOTADB` → `Database could not be decrypted
(wrong passphrase)` and the host **exits without listening**, so the app never
starts. A production build run against the same DB simply shows the unlock screen.
The `(locked — awaiting unlock)` line in `host.log` confirms a production build.

**Build notes:**

- The trailing `-- --no-default-features` is forwarded to `cargo` (Tauri runs
  `cargo build` as the runner); `npm run tauri -- build --no-default-features`
  (without the second `--`) is rejected by the Tauri CLI parser.
- Artifacts: `src-tauri/target/release/bundle/msi/EARTMP_<ver>_x64_en-US.msi` and
  `.../nsis/EARTMP_<ver>_x64-setup.exe`. A non-zero exit referencing
  `TAURI_SIGNING_PRIVATE_KEY` happens **after** the bundles are written (it's only
  the optional updater-signature step) — the installers are valid. Set that env
  var only if you want signed auto-update artifacts.

**Install / data layout (Windows, per-user — no UAC):**

- Program: `%LOCALAPPDATA%\EARTMP\` (replaced on reinstall).
- Data: `%APPDATA%\edu.eartmp.desktop\` — `eartmp.db` + **`eartmp.db.salt`**, `logs/host.log`, branding. **Never** in the program dir, so a clean
  uninstall/reinstall preserves it. Back up `eartmp.db` **and** its sibling
  `eartmp.db.salt` together — the encrypted DB is unrecoverable without the salt.
- Migrations bundled under `%LOCALAPPDATA%\EARTMP\migrations\` apply on first
  launch after unlock.

---

## Known boundaries (by design, not defects)

- **Shell phase pending:** no UI; the runtime data layer is dev-only Prisma
  (ADR-007) — replaced by the Tauri-SQL plugin in the shell.
- **Single-operator assumptions:** audit-chain serialization, transcript
  numbering sequence, and import sizing target a single operator; concurrent
  multi-writer ordering is a shell/DB-sequence concern.
- **Reconstructed specs:** the three binding specs were reconstructed from
  artifacts; reconcile against the authoritative SDP when available.
