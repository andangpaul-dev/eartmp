# Phase 12 — Implementation Notes & Verification

**Status:** Implemented. All gates green. **Awaiting approval to start Phase 13.**

Approved: Ed25519 signing (sign the snapshot hash), snapshot captures data +
resolved layout, signature stored in the existing `verificationHash` JSON column,
numbering from `transcriptNumberRule`, new `transcripts.read`, engine-only (no
PDF/DOCX).

---

## Verification evidence (commands run)

| Gate                | Command                   | Result                                                                                                    |
| ------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------- |
| Type-check          | `npm run typecheck`       | **clean**                                                                                                 |
| Lint (+ boundaries) | `npm run lint`            | **0 errors**                                                                                              |
| Format              | `npm run format:check`    | **conforms**                                                                                              |
| Tests               | `npm run test:coverage`   | **200 passed**; stmts **93.8%** · branch **85.1%** · funcs **88.1%**                                      |
| Seed                | `npm run db:seed`         | idempotent; `transcripts.read` + signing keypair generated once                                           |
| End-to-end demo     | `npm run demo:transcript` | generate `TR-2026-000001` (DRAFT) · **verify valid=true** · **tamper → valid=false** · approve → APPROVED |

---

## What was built

- **`TranscriptBinder`** (`src/domain/services/`, pure) — binds a template layout
  block tree to a `ReportData`, producing a format-agnostic **`ResolvedDoc`**
  (AD12.1). Supports title/text/fieldGrid/sessionLoop→courseTable/summary/remarks/
  signatureRow/qr; `bind` is required (fail loud), `template` is lenient (AD12.6).
- **`ReportData`/`ResolvedDoc`** types + **`BuildReportData`** assembler
  (institution + student + per-semester course tables + the Phase 11 summary;
  structure names behind one `TranscriptNameResolver`).
- **Signed verification (ADR-009/F-14):** `SignaturePort` + **Ed25519
  `CryptoSignatureService`** (Node `crypto`). The snapshot string is signed; the
  `Transcript.verificationHash` stores `{ signature, keyId }`.
- **`GenerateTranscript`** — number → assemble → bind → **snapshot (data +
  resolved layout, ADR-006 amend)** → sign → persist `DRAFT`; **`VerifyTranscript`**
  (verifies with the public key, no DB recompute) ; **`ApproveTranscript`**
  (DRAFT → APPROVED via `TranscriptRules`).
- **Numbering** — `expandNumberRule` (pure) + `nextTranscriptNumber` (count-based
  sequence); **canonical `TranscriptStore`** + `TranscriptTemplateRepository` +
  Prisma impls.
- **Seed** — `transcripts.read` permission + an Ed25519 keypair generated once
  (public + private PEM in settings; private is dev-plaintext, hardening flagged
  for P18/19). `scripts/demo-transcript.ts`.
- **Tests** (`tests/transcripts/`): binder (binds + loops + fail-loud + lenient),
  Ed25519 sign/verify/tamper/wrong-key, numbering, `BuildReportData` assembly,
  and `GenerateTranscript`/`VerifyTranscript`/`ApproveTranscript` incl. the
  **tamper-fails-verification** assertion.

---

## Decisions honoured

- **Signed (not hashed) verification** — a tampered snapshot fails (demo + test).
- **Snapshot captures data + resolved layout** (ADR-006 amend) — re-issue exact.
- **Engine only** — no PDF/DOCX (Phase 13/14); the ResolvedDoc is what they consume.
- Signature in the existing `verificationHash` JSON column (no migration).
- Numbering from `Institution.transcriptNumberRule`; `[ASSUMPTION]` Template V1
  layout still tracks the real sample when supplied.

> Private-key storage is dev-plaintext in a setting; production must encrypt it at
> rest via the passphrase KDF — flagged for the hardening phase (P18/19).

---

## Definition of Done (CLAUDE.md)

- [x] ReportData + pure binder + snapshot + signed verification + numbering +
      persistence built, gated, audited.
- [x] `VerifyTranscript` verifies a good transcript and **rejects a tampered one**.
- [x] `demo:transcript` generates, signs, numbers, verifies (+ tamper fails), approves.
- [x] Tests pass (200); coverage ≥80% (93.8%); `tsc` strict clean; lint/format clean.
- [x] Boundaries intact (binder pure; fitness test green).
- [x] `/docs` updated; summary posted; approval requested before Phase 13.

_Next: Phase 13 — Reporting: PDF (PDFMake renderer: ResolvedDoc → PDF, branding,
QR image, DRAFT watermark, export gated by status)._
