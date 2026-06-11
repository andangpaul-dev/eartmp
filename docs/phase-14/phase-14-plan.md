# Phase 14 — Reporting: DOCX

**Project:** EARTMP · **Phase:** 14 · **Status:** Plan drafted, awaiting approval
to implement · **Predecessor:** Phase 13 (implemented)

> Deliverables-before-implementation spec, in the mandated format. Nothing is
> built until you approve. A **focused** phase: the `DocumentRendererPort`,
> `ExportTranscript` (status gate, snapshot sourcing, audit), and the tests for
> them already exist from Phase 13 — Phase 14 adds a second renderer.

---

## Executive Summary

Phase 14 adds an **editable Word (.docx)** output. Because Phase 13 put rendering
behind a **`DocumentRendererPort`** consuming the format-agnostic `ResolvedDoc`,
this phase is just a **second renderer** (`DocxRenderer`) plus a wiring/demo —
`ExportTranscript` is unchanged (it already takes a renderer + content-type +
extension). PDF stays the canonical issued document; DOCX is the editable copy.
Same snapshot sourcing, status gate, and audit as PDF.

---

## Scope & sequencing

| Concern                                                         | Phase 14          | Deferred to                 |
| --------------------------------------------------------------- | ----------------- | --------------------------- |
| `DocxRenderer` (ResolvedDoc → .docx bytes) on the existing port | ✅ built + tested | —                           |
| Blocks → docx (paragraphs, tables, signatures, QR image)        | ✅                | —                           |
| DRAFT banner (docx watermark equivalent)                        | ✅                | —                           |
| `ExportTranscript` reuse (no changes)                           | ✅ (wiring only)  | —                           |
| UI / batch / pixel-faithful sample                              | ⛔                | Shell / when sample arrives |

---

## Objectives

1. **`DocxRenderer`** implementing `DocumentRendererPort` — maps the `ResolvedDoc`
   block tree to a `docx` `Document` and returns `.docx` bytes.
2. Block coverage parity with PDF: title, text, fieldGrid, courseTable, summary,
   remarks, signatureRow, **QR image** (embedded), and a **DRAFT banner** when a
   watermark is requested (docx has no native watermark — a top banner paragraph
   `DRAFT — NOT VALID`).
3. Wire `ExportTranscript` with the DOCX renderer + content-type/extension (the
   use-case already parameterises these — no use-case change).

**Out of scope:** UI, batch export, pixel-faithful Template V1 (needs the sample).

---

## Deliverables

| #   | Deliverable                                                                                                                              | Layer                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| D1  | `docx` dependency                                                                                                                        | deps                    |
| D2  | `DocxRenderer` (infra) — `ResolvedDoc` → `.docx` bytes via the `docx` library; QR via `qrcode`; DRAFT banner                             | infra                   |
| D3  | Confirm `ExportTranscript` works with the DOCX renderer (content-type/extension via the existing constructor params)                     | application (no change) |
| D4  | `scripts/demo-docx.ts` — export a `.docx` (DRAFT banner + approved clean); assert the `PK` (zip) signature                               | scripts (dev)           |
| D5  | Tests (≥80%) — DocxRenderer smoke (valid `.docx`/`PK` bytes + watermark banner), and `ExportTranscript` with DOCX content-type/extension | tests                   |
| D6  | `/docs` update + implementation notes                                                                                                    | docs                    |

---

## Architecture Decisions

- **AD14.1 — Same port, second renderer (the Phase 13 payoff).** `DocxRenderer`
  implements `DocumentRendererPort`; `ExportTranscript` is unchanged. PDF and DOCX
  diverge only in the renderer.
- **AD14.2 — DOCX is best-effort editable; PDF is canonical.** The `docx` and
  PDFMake layout models differ; we render the same `ResolvedDoc` faithfully by
  content, not pixel-for-pixel (F-30). The signed PDF remains the issued document.
- **AD14.3 — DRAFT banner instead of a true watermark.** docx lacks a simple
  diagonal watermark; a prominent top banner paragraph conveys "DRAFT — NOT VALID"
  (the status gate still blocks official DOCX export of a DRAFT).
- **AD14.4 — Application never imports `docx`.** The renderer is the only place;
  the boundary fitness test continues to guard this.
- **AD14.5 — Render from snapshot** (inherited from `ExportTranscript`, ADR-006).

---

## Database Changes

- **None.** Reuses `Transcript.snapshot` + the audit log; no new permissions.

---

## UI Screens

**None in Phase 14.**

---

## Services / Use-cases (contracts, abridged)

- `DocxRenderer implements DocumentRendererPort` — `render(resolvedDoc, opts): Promise<Uint8Array>`.
- `ExportTranscript` (unchanged) wired with `contentType =
"application/vnd.openxmlformats-officedocument.wordprocessingml.document"`,
  `extension = "docx"`.

---

## Validation Rules

- Inherited from `ExportTranscript`: status gate (official needs APPROVED/LOCKED;
  DRAFT preview banner), snapshot must parse, authorized + audited.

---

## Test Plan

| Test                    | Asserts                                                                   |
| ----------------------- | ------------------------------------------------------------------------- |
| DocxRenderer smoke      | produces a valid `.docx` (bytes start with `PK`, zip); non-empty          |
| watermark banner        | a DRAFT render includes the `DRAFT — NOT VALID` banner text               |
| ExportTranscript (DOCX) | filename `*.docx`, content-type docx, watermark passed through on preview |
| coverage                | ≥80% on new code                                                          |

The renderer smoke test produces real `.docx` bytes; gating reuses the Phase 13
ExportTranscript tests.

---

## Risks

| ID    | Risk                           | Mitigation                                      |
| ----- | ------------------------------ | ----------------------------------------------- |
| P14-a | `docx` API shape / ESM interop | small, well-typed library; smoke test in CI     |
| P14-b | Watermark fidelity             | banner approach (AD14.3); PDF remains canonical |
| P14-c | Layout parity PDF↔DOCX         | content-faithful, not pixel (AD14.2 / F-30)     |
| P14-d | `docx` supply chain            | pin version; isolated behind the renderer       |

---

## Completion Criteria

- [ ] `DocxRenderer` on the existing port; `ExportTranscript` produces `.docx`
      (status-gated, from snapshot, audited) with no use-case change.
- [ ] `demo:docx` writes a valid `.docx` (DRAFT banner + approved clean).
- [ ] Tests pass; coverage ≥80% on new code; `tsc` strict clean; lint/format clean.
- [ ] Boundaries intact (application never imports `docx`; fitness test green).
- [ ] `/docs` updated; summary posted; **approval requested before Phase 15.**

---

## Approval Checklist (to start Phase 14 implementation)

- [ ] Scope confirmed: `DocxRenderer` on the existing port; reuse `ExportTranscript`.
- [ ] Add the **`docx`** dependency — OK?
- [ ] **DRAFT banner** (vs a true watermark) for DOCX — OK?
- [ ] PDF stays canonical, DOCX best-effort editable (content-faithful) — OK?
- [ ] Go-ahead to implement.

_Related: [reporting-architecture.md](../phase-0/reporting-architecture.md) ·
[phase-13 implementation notes](../phase-13/implementation-notes.md) (DocumentRendererPort / ExportTranscript)_
