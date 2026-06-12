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

## Known boundaries (by design, not defects)

- **Shell phase pending:** no UI; the runtime data layer is dev-only Prisma
  (ADR-007) — replaced by the Tauri-SQL plugin in the shell.
- **Single-operator assumptions:** audit-chain serialization, transcript
  numbering sequence, and import sizing target a single operator; concurrent
  multi-writer ordering is a shell/DB-sequence concern.
- **Reconstructed specs:** the three binding specs were reconstructed from
  artifacts; reconcile against the authoritative SDP when available.
