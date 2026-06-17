# Per-institution transcript signing (Tier 0 — Phase F)

Builds on the multi-institution tenancy foundation (Phases A–E: `institutionId`
scoping, denormalized tree, per-institution code uniqueness + transcript
numbering, branding). Phase F lets each institution **sign its own transcripts**
with a **dedicated keypair**, while keeping single-institution and legacy
deployments byte-for-byte unchanged.

## Model

- One **global** signing keypair already lives in two registry settings
  (`transcript.signingPublicKey` / `transcript.signingPrivateKey`, sealed).
- An institution **may** own a **dedicated** keypair, stored under **namespaced**
  setting rows `…:<institutionId>` holding the raw PEM / sealed string (no
  registry envelope — the values are opaque).
- **Fallback:** an institution with no dedicated key signs and verifies with the
  global key. So a fresh single-institution install behaves exactly as before —
  **no migration, no schema change** (keys are dynamic Setting rows).

The naming + fallback rules live in one place: `domain/settings/signingKeys.ts`
(`resolveSigningPublic` / `resolveSigningPrivate` / `hasOwnSigningKey` /
`writeSigningKeys` / `readOwnSealedPrivate`). The key provider and the
provision/rotate use-cases all go through it.

## Sign vs. verify

- **Sign** (GenerateTranscript) resolves the **issuing institution** from the
  student (Phase B), then asks the host for that institution's **unsealed**
  signer via a `SignerResolver`. The host throws if the relevant key is still
  sealed, before any transcript number is allocated.
- **Verify** (VerifyTranscript) resolves a **verify-only** signer from the
  transcript's stored `institutionId` via a `VerifierResolver` — public key only,
  **no passphrase / no unseal**. `CryptoSignatureService.verifier(publicPem)`
  builds a signer whose `sign()` throws. A transcript signed by institution A
  verifies with A's key and **fails** against B's (key isolation).

## Host session (composition.ts)

The single in-memory `signer` became a `Map<institutionId, SignaturePort>` where
the empty string `""` is the **global slot**. `slotFor(institutionId)` returns
the institution's own slot when it has a dedicated key, else the global slot.

- `unsealKey({ passphrase, institutionId? })` — unseals the slot for the given
  (or the caller's) institution; an unscoped operator unseals the global slot.
- `keyState` / `sealKey` — operate on the caller's institution slot (or an
  explicit one), falling back to global.
- `keyStatus({ institutionId? })` — for an institution, `provisioned` means it
  owns a **dedicated** key; otherwise reports the global key.
- `generateTranscript` / `verifyTranscript` are wired with `resolveSigner` /
  `resolveVerifier`.

## Authorization

`ProvisionSigningKey` and `ChangeKeyPassphrase` gained an optional
`institutionId` and a scope guard:

- With `institutionId` → `requireInScope(institutionId, session)` (a scoped
  operator may only manage **its own** institution's key).
- Without `institutionId` (the shared/default key) → **global administrator
  only**.
- A **first** dedicated key for an institution does not need `replaceExisting`
  (it is distinct from the global key); replacing an existing one does.
- A per-institution passphrase rotation requires that the institution already
  owns a dedicated key.

Audit records the action + `institutionId` only — never key material or
passphrases (AD18.4 preserved).

## UI

The Security screen gained a **scope selector** (Default / each institution).
Choosing an institution drives `keyStatus`, provision/replace, and passphrase
rotation for that institution's dedicated key; "Uses default key" is shown when
it has none. Single-institution deployments leave the scope on **Default** and
see the previous behaviour. The topbar key chip + Transcripts unseal use the
caller's institution slot automatically.

## Tests

`tests/security/per-institution-signing.test.ts` — namespaced provisioning,
first-dedicated-key vs. replace, scope guards (own vs. other vs. global),
per-institution rotation (+ no-dedicated-key refusal), key **isolation**
(one institution can't verify another's signature), global **fallback**, and the
verify-only signer rejecting `sign()`. Existing signing/transcript suites updated
for the resolver signatures. Full suite green (446).
