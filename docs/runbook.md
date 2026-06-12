# EARTMP — Operator Runbook

How to provision, run, verify, and operate the EARTMP **headless core** (Phases
0–20). The runnable desktop product (UI + the Tauri-SQL runtime) is the separate
**shell phase**; this runbook covers the dev/headless build that the shell wraps.

---

## 1. Prerequisites

- Node.js (LTS) + npm.
- `npm install` (installs Prisma 6, the crypto libs, pdfmake/docx/xlsx).

## 2. First-time setup

```bash
npm install
npx prisma migrate deploy      # apply migrations to dev.db
npm run db:seed                # idempotent: RBAC, default config, admin user, sealed signing key
```

- **Default admin:** `admin` / `ChangeMe123!` (Argon2id-hashed; change on first use).
- **Bootstrap key passphrase:** `EARTMP_KEY_PASSPHRASE` (default `eartmp-dev-passphrase`).
  The transcript signing key is **sealed** with it; set your own in production:
  `EARTMP_KEY_PASSPHRASE=… npm run db:seed`.

## 3. The verification gate (run before any commit / release)

```bash
npm run typecheck       # tsc --noEmit, strict
npm run lint            # eslint + import-boundary (Clean Architecture) rules
npm run format:check    # prettier
npm run test:coverage   # vitest; ≥80% on domain+application
```

All four must be green. The boundary fitness test (`tests/architecture.test.ts`)
fails the build if any layering rule is violated.

## 4. Runnable demos (prove each capability end to end)

| Command                          | Proves                                         |
| -------------------------------- | ---------------------------------------------- |
| `npm run demo:login`             | auth / RBAC                                    |
| `npm run demo:structure`         | academic structure                             |
| `npm run demo:records`           | students/courses/enrollment                    |
| `npm run demo:results`           | enter → process → lock/unlock                  |
| `npm run demo:import`            | spreadsheet import (validate → atomic commit)  |
| `npm run demo:summary`           | GPA / CGPA / standing                          |
| `npm run demo:transcript`        | generate → sign → verify (tamper fails)        |
| `npm run demo:pdf` / `demo:docx` | export PDF / DOCX (status-gated)               |
| `npm run demo:template`          | template designer (validate, version, default) |
| `npm run demo:graduation`        | eligibility + clearance                        |
| `npm run demo:backup`            | encrypted backup + integrity/tamper            |
| `npm run demo:security`          | sealed key + change passphrase                 |
| `npm run demo:audit`             | queryable trail + tamper-evident chain         |
| **`npm run demo:e2e`**           | **the whole pipeline, end to end**             |

All demos are **non-destructive**: they self-provision and clean up.

## 5. Operations

- **Backup:** `CreateBackup` produces an AES-256-GCM envelope keyed by the
  operator passphrase. **Restore is verify-first + atomic** — a tampered or
  wrong-passphrase backup is rejected with zero writes. _Lost passphrase = an
  unrecoverable backup; there is no key escrow by design._
- **Rotate the key passphrase:** `ChangeKeyPassphrase` re-seals the signing key
  under a new passphrase (old fails, new works; the key is unchanged).
- **Audit:** `GetAuditLog` to query; `VerifyAuditChain` to confirm the trail is
  unaltered (reports the first broken link if not).

## 6. Architecture boundaries (don't break these)

- Domain imports nothing outward (no Prisma/React/crypto-lib).
- UI/use-cases never touch the DB directly — only repository **ports**.
- Grading scales, transcript layouts, graduation rules, institution data are
  **runtime config**, never hardcoded.

_See `docs/release-checklist.md` for the release gate and `docs/README.md` for the
phase index._
