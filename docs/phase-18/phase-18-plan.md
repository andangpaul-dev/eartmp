# Phase 18 — Security Hardening

**Project:** EARTMP · **Phase:** 18 · **Status:** Plan drafted, awaiting approval
to implement · **Predecessor:** Phase 17 (implemented)

> Deliverables-before-implementation spec, in the mandated format. Nothing is
> built until you approve. Logic only; the SQLCipher DB-file wiring is a Tauri-SQL
> shell concern (this phase locks the contract + seals app-level secrets). Same
> proof model: headless, ≥80% coverage, dev adapter, runnable demo.

---

## Executive Summary

Phase 18 removes the last **plaintext secret**. The transcript-signing **private
key** — stored in the clear since Phase 12 (flagged then) — is **sealed** with the
operator passphrase (AES-256-GCM + Argon2 KDF), so the signing key at rest is
useless without the passphrase. A **`SigningKeyProvider`** opens it on demand to
sign; a **`ChangeKeyPassphrase`** path re-seals it under a new passphrase without
ever exposing the key. The phase also **finalizes ADR-008** (DB-at-rest via
SQLCipher, keyed by the same passphrase KDF — wired in the shell) and does a
**secrets review** (no passphrases/keys in logs or the audit trail).

---

## Scope & sequencing

| Concern                                                | Phase 18          | Deferred to       |
| ------------------------------------------------------ | ----------------- | ----------------- |
| Seal the signing private key at rest (AES-GCM + KDF)   | ✅ built + tested | —                 |
| `SigningKeyProvider` (open sealed key → SignaturePort) | ✅                | —                 |
| `ChangeKeyPassphrase` (re-seal, no key exposure)       | ✅                | —                 |
| Seed seals the key (bootstrap passphrase)              | ✅                | —                 |
| Secrets review (no secrets in logs/audit)              | ✅                | —                 |
| **ADR-008 finalized** (DB-at-rest contract)            | ✅ (doc)          | —                 |
| **SQLCipher DB-file encryption wiring**                | ⛔                | Shell (Tauri-SQL) |
| OS keychain / HSM key storage                          | ⛔                | later (post-MVP)  |
| UI (unlock prompt)                                     | ⛔                | Shell phase       |

---

## Objectives

1. A **`SecretBox`** (infra) — `seal(secret, passphrase): string` /
   `open(sealed, passphrase): string`; AES-256-GCM + Argon2 KDF; the sealed value
   is **self-contained** (salt+iv+authTag+ciphertext in one base64 string) so it
   drops into a single setting field.
2. **Seal the signing private key** — the `transcript.signingPrivateKey` setting
   stores a **sealed** value; seed seals the generated key with a **bootstrap
   passphrase** (`EARTMP_KEY_PASSPHRASE` env, documented dev default).
3. **`SigningKeyProvider`** — given the passphrase, opens the sealed private key +
   loads the public key, returning a `SignaturePort` (CryptoSignatureService).
   Wire `GenerateTranscript`'s signer through it.
4. **`ChangeKeyPassphrase`** (`security.manage`) — open with the old passphrase,
   re-seal with the new; the raw key never leaves the process boundary; audited
   (without secrets).
5. **Secrets review + ADR-008 finalization** — confirm passphrases/keys never
   appear in audit `oldValue`/`newValue` or logs; lock the DB-at-rest contract
   (salt setting + KDF) for the shell.

**Out of scope:** SQLCipher wiring, OS keychain, UI.

---

## Deliverables

| #   | Deliverable                                                                                                                 | Layer               |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| D1  | `SecretBox` (infra) — self-contained AES-256-GCM seal/open over the Argon2 KDF                                              | infra               |
| D2  | `SigningKeyProvider` — open sealed private key + public key → `SignaturePort`                                               | application + infra |
| D3  | Seed: seal the generated private key (bootstrap passphrase via env/default); store sealed                                   | seed                |
| D4  | `ChangeKeyPassphrase` use-case (`security.manage`) — re-seal, audited                                                       | application         |
| D5  | Seed: `security.manage` permission                                                                                          | seed                |
| D6  | Secrets-review pass: assert no secret material in audit entries / a redaction guard                                         | application + tests |
| D7  | ADR-008 finalized in `/docs`; key-handling notes updated                                                                    | docs                |
| D8  | `scripts/demo-security.ts` — seal/open a secret, sign via the sealed key, wrong-passphrase fails, change-passphrase re-seal | scripts (dev)       |
| D9  | Tests (≥80%) — seal round-trip + tamper + wrong passphrase, signer-from-sealed-key, change-passphrase, redaction            | tests               |
| D10 | `/docs` update + implementation notes                                                                                       | docs                |

---

## Architecture Decisions

- **AD18.1 — Secrets sealed, never plaintext.** App-level secrets (the signing
  private key) are sealed with AES-256-GCM keyed by the passphrase-derived Argon2
  key; the sealed blob is self-describing (salt/iv/tag inside). Closes the Phase 12
  plaintext-key note + F-12.
- **AD18.2 — One passphrase, two uses.** The same operator passphrase derives the
  DB-at-rest key (ADR-008, shell) and the secret-sealing key (distinct salts), so
  there's a single human secret to manage.
- **AD18.3 — Key never leaves the boundary.** `SigningKeyProvider` opens the key
  in memory to construct the signer; `ChangeKeyPassphrase` re-seals in memory. The
  raw key is never persisted plaintext, logged, or audited.
- **AD18.4 — Redaction by construction.** Audit entries for key/secret operations
  record the action + non-secret metadata only; a guard/test asserts no sealed
  blob or passphrase leaks into `oldValue`/`newValue`.
- **AD18.5 — DB-at-rest contract locked, wiring deferred.** ADR-008 is finalized
  (SQLCipher keyed by the KDF + the existing `institution.encryptionSalt`); the
  physical PRAGMA-key wiring lands with the Tauri-SQL shell — not faked here.

---

## Database Changes

- **None to the schema shape.** The `transcript.signingPrivateKey` setting now
  holds a **sealed** value (same column, different content). `institution.encryptionSalt`
  already exists (Phase 2/17).
- **Seed:** seal the private key; add `security.manage` permission.

---

## UI Screens

**None in Phase 18.** Future consumer (deferred): an unlock/passphrase prompt + a
change-passphrase screen.

---

## Services / Use-cases (contracts, abridged)

- `SecretBox.seal(secret, passphrase): string` / `open(sealed, passphrase): string`
- `SigningKeyProvider.getSigner(passphrase): Promise<SignaturePort>`
- `ChangeKeyPassphrase.execute({ oldPassphrase, newPassphrase }, session)` → `security.manage`

---

## Validation Rules

- `open` throws on a tampered blob or wrong passphrase (GCM auth) — surfaced as a
  clear "could not unlock" error, never a stack-trace of key bytes.
- Signing requires a successfully-opened key; a wrong passphrase fails before any
  transcript is produced.
- `ChangeKeyPassphrase`: old passphrase must open the current sealed key; new
  sealed value replaces it atomically; authorized + audited (no secrets recorded).

---

## Test Plan

| Test                       | Asserts                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| SecretBox round-trip       | `open(seal(s, p), p) === s`                                                                      |
| tamper / wrong passphrase  | flipping the sealed blob or a wrong passphrase → `open` throws                                   |
| signer from sealed key     | `SigningKeyProvider` produces a signer that signs + verifies; a sealed transcript still verifies |
| wrong passphrase → no sign | opening with the wrong passphrase throws before signing                                          |
| change passphrase          | re-seal under a new passphrase; old fails, new opens; key unchanged (same signatures verify)     |
| redaction                  | a key/secret operation's audit entry contains no sealed blob or passphrase                       |
| authz                      | `ChangeKeyPassphrase` gated by `security.manage`                                                 |
| coverage                   | ≥80% on new code                                                                                 |

---

## Risks

| ID    | Risk                                        | Mitigation                                                                      |
| ----- | ------------------------------------------- | ------------------------------------------------------------------------------- |
| P18-a | Lost passphrase = unrecoverable signing key | by design (no plaintext copy); operator-managed; documented                     |
| P18-b | Dev bootstrap passphrase weak/known         | env-overridable, clearly marked dev-only; production sets its own               |
| P18-c | Secrets leaking into audit/logs             | redaction-by-construction + an explicit test (AD18.4)                           |
| P18-d | SQLCipher not actually applied yet          | ADR-008 contract locked; wiring is the shell's job (AD18.5) — stated, not faked |
| P18-e | Passphrase change racing a sign             | single-operator v1; re-seal is a discrete admin action                          |

---

## Completion Criteria

- [ ] Signing private key sealed at rest; `SigningKeyProvider` + `ChangeKeyPassphrase`
      built, gated, audited; secrets-review guard in place.
- [ ] ADR-008 finalized (DB-at-rest contract); plaintext-key note from Phase 12 closed.
- [ ] `demo:security` shows seal/open, sign-via-sealed-key, wrong-passphrase failure,
      and a passphrase change.
- [ ] Tests pass; coverage ≥80% on new code; `tsc` strict clean; lint/format clean.
- [ ] Boundaries intact (use-cases free of crypto; fitness test green).
- [ ] `/docs` updated; summary posted; **approval requested before Phase 19.**

---

## Approval Checklist (to start Phase 18 implementation)

- [ ] Scope confirmed: seal the signing private key + re-seal path + finalize ADR-008, logic only (SQLCipher wiring deferred to shell).
- [ ] Sealing: **AES-256-GCM + Argon2 passphrase KDF**, self-contained sealed value in one setting — OK?
- [ ] Dev **bootstrap passphrase** via `EARTMP_KEY_PASSPHRASE` (documented dev default) for the seed — OK?
- [ ] Include **`ChangeKeyPassphrase`** (re-seal under a new passphrase) — OK?
- [ ] New `security.manage` permission — OK?
- [ ] DB-at-rest (SQLCipher) **contract finalized now, wiring deferred to shell** — OK.
- [ ] Go-ahead to implement.

_Related: [phase-12 implementation notes](../phase-12/implementation-notes.md) (plaintext-key note) ·
`src/infrastructure/crypto/BackupCipher.ts` (Phase 17 AES-GCM) ·
`src/application/ports/KeyDerivationPort.ts` (Phase 2) ·
[architecture-review.md](../phase-0/architecture-review.md) (ADR-008, F-12)_
