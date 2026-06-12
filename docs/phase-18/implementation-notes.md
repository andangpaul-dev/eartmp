# Phase 18 — Implementation Notes & Verification

**Status:** Implemented. All gates green. **Awaiting approval to start Phase 19.**

Approved: seal the signing private key + re-seal path + finalize ADR-008 (logic
only); AES-256-GCM + Argon2 passphrase KDF, self-contained sealed value; dev
bootstrap passphrase via `EARTMP_KEY_PASSPHRASE`; `ChangeKeyPassphrase`; new
`security.manage`.

---

## Verification evidence (commands run)

| Gate                | Command                   | Result                                                                                                                 |
| ------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Type-check          | `npm run typecheck`       | **clean**                                                                                                              |
| Lint (+ boundaries) | `npm run lint`            | **0 errors**                                                                                                           |
| Format              | `npm run format:check`    | **conforms**                                                                                                           |
| Tests               | `npm run test:coverage`   | **257 passed**; stmts **93.4%** · branch **85.0%** · funcs **89.6%**                                                   |
| Seed                | `npm run db:seed`         | idempotent; signing key now **sealed**; `security.manage` added                                                        |
| Demo (security)     | `npm run demo:security`   | ✓ seal/open · ✓ sign via SEALED key · ✓ wrong passphrase rejected · ✓ change-passphrase re-seal (old fails, new works) |
| Demo (transcript)   | `npm run demo:transcript` | ✓ still signs/verifies — now through the sealed key                                                                    |

---

## What was built

- **`SecretBox`** (`infrastructure/crypto/`) — AES-256-GCM `seal`/`open`; key from
  the operator passphrase via the Phase 2 Argon2 KDF (hashed to 32 bytes); the
  sealed value is **self-contained** (salt+iv+tag+ciphertext, one base64 string).
  `open` throws a non-revealing `SecurityError` on tamper/wrong passphrase.
  Implements `SecretSealerPort` (app port) so use-cases stay crypto-free.
- **`SigningKeyProvider`** port + **`SealedSigningKeyProvider`** (infra) — opens
  the sealed private key + loads the public key, returns a `CryptoSignatureService`.
  The raw key is decrypted in memory only (AD18.3).
- **`ChangeKeyPassphrase`** (`security.manage`) — open-with-old → reseal-with-new;
  the key/passphrases are **never** logged or audited (AD18.4 — a redaction test
  asserts this).
- **Seed:** the generated private key is **sealed** with a bootstrap passphrase
  (`EARTMP_KEY_PASSPHRASE`, dev default `eartmp-dev-passphrase`); `security.manage`
  permission added.
- **Wiring:** `demo-transcript.ts` now obtains its signer via the sealed-key
  provider (no plaintext key read). `scripts/demo-security.ts` added.
- **Tests:** `secret-box.test.ts` (round-trip, tamper, wrong passphrase, malformed,
  isSealed) + `sealed-signing-key.test.ts` (signer-from-sealed-key, wrong
  passphrase, change-passphrase, **redaction**, authz).

---

## ADR-008 — status (finalized)

- **App-level secret sealing: DONE** (this phase). The transcript-signing private
  key is encrypted at rest with the passphrase-derived key; no plaintext secret
  remains in the settings table. This **closes the Phase 12 plaintext-key note**
  and F-12 at the application layer.
- **DB-file-at-rest (SQLCipher): contract locked, wiring deferred to the shell.**
  The same operator passphrase derives the DB key (via the existing
  `institution.encryptionSalt` + the Argon2 `KeyDerivationPort`); the physical
  `PRAGMA key` on the Tauri-SQL connection lands with the shell data layer — stated,
  not faked (AD18.5).

---

## Decisions honoured

- **Secrets sealed, never plaintext** (AD18.1) — demo + tests prove it.
- **One passphrase, two uses** (AD18.2); **key never leaves the boundary** (AD18.3).
- **Redaction by construction** (AD18.4) — audit holds the action only.
- **DB-at-rest contract locked, wiring deferred** (AD18.5).
- No schema changes (same `transcript.signingPrivateKey` column, sealed content).

---

## Definition of Done (CLAUDE.md)

- [x] Signing key sealed at rest; `SigningKeyProvider` + `ChangeKeyPassphrase`
      built, gated, audited; redaction guard in place.
- [x] ADR-008 finalized; Phase 12 plaintext-key note closed.
- [x] `demo:security` shows seal/open, sign-via-sealed-key, wrong-passphrase failure,
      passphrase change; `demo:transcript` still works through the sealed key.
- [x] Tests pass (257); coverage ≥80% (93.4%); `tsc` strict clean; lint/format clean.
- [x] Boundaries intact (use-cases free of crypto; fitness test green).
- [x] `/docs` updated; summary posted; approval requested before Phase 19.

_Next: Phase 19 — Audit & Observability (queryable audit trail use-cases,
tamper-evident audit chain, structured app logging) — `audit.read` already seeded._
