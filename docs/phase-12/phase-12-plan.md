# Phase 12 — Transcript Engine

**Project:** EARTMP · **Phase:** 12 · **Status:** Plan drafted, awaiting approval
to implement · **Predecessor:** Phase 11 (implemented)

> Deliverables-before-implementation spec, in the mandated format. Nothing is
> built until you approve. Same proof model: headless domain/application logic,
> ≥80% coverage, dev adapters, runnable demo. **This phase is the transcript
> ENGINE — data assembly, binding, snapshot, signed verification, numbering,
> persistence. PDF/DOCX rendering is Phase 13/14.**

---

## 0. Decision up front — signed verification (ADR-009 / F-14)

ADR-009 chose **digital-signature** transcript verification over a self-hash: the
transcript carries a signature made with the **institution's private key**, so a
third party can verify it with the **public key** and **no database**. Phase 12
implements this behind a `SignaturePort`:

- **Algorithm:** Ed25519 (Node `crypto`) — small keys/signatures, fast, standard.
- **What's signed:** a canonical hash (SHA-256) of the frozen snapshot; the
  `Transcript` stores `{ hash, signature, keyId }`.
- **Keypair provisioning:** the institution keypair is **generated once** and the
  **public** key stored in a setting (`institution.transcriptPublicKey`).
- **Private-key storage** is the open question. **Recommendation for now:** store
  it encrypted-at-rest via the Phase 2 `KeyDerivationPort` (operator passphrase →
  key → encrypt the private key); the **full secure-key-storage hardening**
  (HSM-style / OS keychain) is a Phase 18/19 concern. For the **headless dev
  build**, the keypair is generated and the private key kept in a dev setting,
  clearly marked, so the demo can sign + verify end-to-end.

**Confirm:** Ed25519 + sign-the-snapshot-hash, public key in a setting, private
key encrypted via the passphrase KDF (full hardening later). If you'd rather defer
signing and ship the plain hash for v1, say so and I'll scope it down.

---

## Executive Summary

Phase 12 builds the **transcript engine**. It assembles a **`ReportData`** DTO
(institution branding + student + the Phase 11 academic summary + per-semester
course tables), **binds** it to a `TranscriptTemplate` layout to produce a
format-agnostic **`ResolvedDoc`**, freezes an immutable **snapshot of both the
data and the resolved layout** (ADR-006 amendment, so re-issue is exact even if
the template later changes), **signs** the snapshot for third-party verification
(ADR-009), assigns a **transcript number**, and persists the `Transcript` with its
status workflow (`DRAFT → APPROVED → LOCKED`). A `VerifyTranscript` use-case
recomputes the hash and checks the signature with the public key — no DB needed.

---

## Scope & sequencing

| Concern                                           | Phase 12          | Deferred to      |
| ------------------------------------------------- | ----------------- | ---------------- |
| `ReportData` assembly                             | ✅ built + tested | —                |
| Template **binder** (layout + data → ResolvedDoc) | ✅ built + tested | —                |
| Snapshot (data **+ resolved layout**)             | ✅                | —                |
| **Signed** verification + `VerifyTranscript`      | ✅                | —                |
| Transcript numbering                              | ✅                | —                |
| Persist `Transcript` + status workflow            | ✅                | —                |
| **PDF rendering**                                 | ⛔                | Phase 13         |
| **DOCX rendering**                                | ⛔                | Phase 14         |
| Template designer UI / QR image                   | ⛔                | Phase 15 / shell |

---

## Objectives

1. **`ReportData`** assembly (`BuildReportData`): institution + student +
   academic summary (Phase 11) + per-semester course rows (code/title/credit/
   grade/gp) + signatures/remarks.
2. **Template binder** (pure): walk the `TranscriptTemplate.layout` block tree,
   resolve `bind` paths against `ReportData`, validate (unknown block / bad bind /
   missing required field), produce a `ResolvedDoc`.
3. **Snapshot**: freeze `{ reportData, resolvedDoc, templateVersion }` as the
   `Transcript.snapshot` (ADR-006 amend) so re-render is exact.
4. **Sign + verify** (ADR-009): hash the snapshot, sign with the institution key,
   store `{ hash, signature }`; `VerifyTranscript` checks it with the public key.
5. **Number + persist**: `nextTranscriptNumber(rule)` from
   `Institution.transcriptNumberRule`; create the `Transcript` (`DRAFT`); an
   `ApproveTranscript` transition (`APPROVED`/`LOCKED`).

**Out of scope:** PDF/DOCX (P13/14), QR image rendering, template designer UI.

---

## Deliverables

| #   | Deliverable                                                                                                                              | Layer          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| D1  | `ReportData` + `ResolvedDoc` types                                                                                                       | domain         |
| D2  | `TemplateBinder` (pure): layout JSON + ReportData → ResolvedDoc, with bind validation + block grammar (Zod-free, domain-local validator) | domain         |
| D3  | `SignaturePort` + `Argon2KeyDerivation`-backed key handling; Ed25519 `CryptoSignatureService` (infra)                                    | port + infra   |
| D4  | `TranscriptRepository` (canonical): `create`, `findById`, `findByNumber`, `findByStudent`, `updateStatus`, `nextTranscriptNumber(rule)`  | domain + infra |
| D5  | `BuildReportData` use-case (assembles from summary/institution/results)                                                                  | application    |
| D6  | `GenerateTranscript` use-case (`transcripts.generate`): build → bind → snapshot → sign → number → persist DRAFT                          | application    |
| D7  | `ApproveTranscript` (`transcripts.approve`) + `VerifyTranscript` (`transcripts.read`/public)                                             | application    |
| D8  | Seed: `transcripts.read` permission + institution keypair (generated once)                                                               | seed           |
| D9  | `scripts/demo-transcript.ts` — generate, snapshot, sign, **verify (tamper → fail)**, number                                              | scripts (dev)  |
| D10 | Tests (≥80%) — binder validation, snapshot immutability, sign/verify + tamper, numbering                                                 | tests          |
| D11 | `/docs` update + implementation notes                                                                                                    | docs           |

---

## Architecture Decisions

- **AD12.1 — Binder is pure + format-agnostic.** It produces a `ResolvedDoc`
  (typed block tree with bound values), not a PDF — so PDF and DOCX renderers
  (P13/14) consume the same resolved structure, and binding is unit-testable with
  no rendering libs.
- **AD12.2 — Snapshot captures data AND resolved layout (ADR-006 amend).** A
  re-issued transcript reproduces exactly even if the template is later edited or
  deleted; nothing re-reads live records or the live template at render time.
- **AD12.3 — Signed verification (ADR-009).** Ed25519 signature over the snapshot
  hash; third-party-verifiable with the public key and no DB (F-14). Private key
  encrypted via the passphrase KDF; full key-storage hardening is P18/19.
- **AD12.4 — Numbering from the institution rule.** `nextTranscriptNumber` expands
  `Institution.transcriptNumberRule` (e.g. `TR-{year}-{seq:000000}`) with a
  monotonic sequence; `transcriptNumber` is unique (Phase 1).
- **AD12.5 — Status workflow + canExport gate.** New transcripts are `DRAFT`;
  `ApproveTranscript` moves to `APPROVED`/`LOCKED`; only those export (P13),
  enforced by `TranscriptRules` (already in the domain).
- **AD12.6 — Bind validation fails loud.** A template binding a path missing from
  `ReportData`, an unknown block, or a required-but-empty field is a generation
  error — never a silently blank legal document.

---

## Database Changes

- **None to the schema shape** — `Transcript` (snapshot, verificationHash,
  status, transcriptNumber, templateId, type) + `TranscriptTemplate` exist
  (Phase 1). The signature is stored in `verificationHash` as
  `{ hash, signature, keyId }` JSON (or we add a column — see decision below).
- `[DECISION]` store the signature inside the existing `verificationHash` column
  (JSON) to avoid a migration, **or** add a `signature` column. _Recommend JSON in
  the existing column for now; a column can come with the next schema bundle._
- **Seed:** `transcripts.read` permission; generate + store the institution
  keypair (public key setting + encrypted private key).

---

## UI Screens

**None in Phase 12.** Future consumers (deferred): generate/preview, status
workflow, verification screen, template designer (P15).

---

## Services / Use-cases (contracts, abridged)

- `BuildReportData.execute({ studentId, type }, session): ReportData`
- `GenerateTranscript.execute({ studentId, templateId?, type }, session): Transcript` → `transcripts.generate`
- `ApproveTranscript.execute({ transcriptId }, session)` → `transcripts.approve`
- `VerifyTranscript.execute({ transcriptId }): { valid: boolean }` (recompute hash + verify signature)
- `SignaturePort`: `sign(data): { signature; keyId }`, `verify(data, signature, publicKey): boolean`

---

## Validation Rules

- Template layout validated (block grammar) on load; binds resolve against the
  pinned `ReportData` shape; required fields non-empty (AD12.6).
- Snapshot is immutable once created; re-generation creates a new transcript.
- Signature verifies against the stored public key; a tampered snapshot fails.
- Numbering unique; status transitions per `TranscriptRules`.
- All writes authorized (fail-closed) + audited.

---

## Test Plan

| Test        | Asserts                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| binder      | resolves binds + loops (sessionLoop/courseTable); unknown block / bad bind / missing required → error |
| ReportData  | assembles institution + student + summary + course rows correctly                                     |
| snapshot    | freezes data + resolved layout; re-render off snapshot is identical                                   |
| sign/verify | valid signature verifies; **a tampered snapshot fails verification**                                  |
| numbering   | expands the rule; uniqueness; monotonic sequence                                                      |
| status      | DRAFT → APPROVED; export gate via TranscriptRules                                                     |
| authz/audit | generate/approve gated + audited                                                                      |
| coverage    | ≥80% on new code                                                                                      |

Binder + signing tested headlessly; signing uses Node `crypto` (no DB).

---

## Risks

| ID    | Risk                                              | Mitigation                                                                       |
| ----- | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| P12-a | Private-key storage in dev is weak                | encrypted via passphrase KDF; full hardening flagged for P18/19 (AD12.3)         |
| P12-b | `ReportData` shape unpinned until the real sample | pin a sensible v1 shape now; the real Template V1 layout is still `[ASSUMPTION]` |
| P12-c | Binder grows into a fragile DSL                   | keep the block grammar small + validated; reassess vs the real sample (F-29)     |
| P12-d | Signature column vs JSON reuse                    | reuse `verificationHash` JSON now; column in the next bundle if needed           |
| P12-e | Numbering races (multi-user)                      | sequence under the UoW; single-operator v1                                       |

---

## Completion Criteria

- [ ] ReportData assembly + pure binder + snapshot (data+layout) + signed
      verification + numbering + persistence built, gated, audited.
- [ ] `VerifyTranscript` verifies a good transcript and **rejects a tampered one**.
- [ ] `demo:transcript` generates, signs, numbers, and verifies (+ tamper fails).
- [ ] Tests pass; coverage ≥80% on new code; `tsc` strict clean; lint/format clean.
- [ ] Boundaries intact (binder pure; fitness test green).
- [ ] `/docs` updated; summary posted; **approval requested before Phase 13.**

---

## Approval Checklist (to start Phase 12 implementation)

- [ ] **§0 signing decision:** Ed25519 + sign-the-snapshot-hash, public key in a
      setting, private key encrypted via the passphrase KDF (full hardening later)
      — or defer signing to a plain hash for v1?
- [ ] **Snapshot captures data + resolved layout** (ADR-006 amend) — OK.
- [ ] Store the signature in the existing `verificationHash` JSON column (vs a new
      column) — OK?
- [ ] Numbering from `Institution.transcriptNumberRule` + a sequence — OK.
- [ ] New `transcripts.read` permission — OK.
- [ ] Scope confirmed: **engine only, no PDF/DOCX** (Phase 13/14).
- [ ] Go-ahead to implement.

_Related: [transcript-template-architecture.md](../phase-0/transcript-template-architecture.md) ·
[reporting-architecture.md](../phase-0/reporting-architecture.md) ·
[architecture-review.md](../phase-0/architecture-review.md) (ADR-006/009, F-14/F-28/F-29) ·
[phase-11 implementation notes](../phase-11/implementation-notes.md) (academic summary)_
