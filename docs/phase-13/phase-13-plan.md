# Phase 13 — Reporting: PDF

**Project:** EARTMP · **Phase:** 13 · **Status:** Plan drafted, awaiting approval
to implement · **Predecessor:** Phase 12 (implemented)

> Deliverables-before-implementation spec, in the mandated format. Nothing is
> built until you approve. Same proof model: the **doc-definition builder is
> pure + unit-tested**; actual PDF bytes are produced by an infra renderer and
> exercised by a demo. UI deferred to the shell phase.

---

## Executive Summary

Phase 13 renders a transcript to **PDF**. It consumes the **frozen `ResolvedDoc`
snapshot** from Phase 12 (never live records, so re-export is byte-stable in
content), maps each resolved block to a **PDFMake** document definition (title,
field grid, course tables, summary, remarks, signatures), embeds the **QR image**
and institution **branding**, and stamps a **DRAFT watermark** when the transcript
isn't approved. Export runs through a **status-gated, audited** use-case
(`TranscriptRules.canExport`). The renderer sits behind a `DocumentRendererPort`
so the DOCX renderer (Phase 14) is a sibling, not a rewrite.

---

## Scope & sequencing

| Concern                                               | Phase 13              | Deferred to      |
| ----------------------------------------------------- | --------------------- | ---------------- |
| `ResolvedDoc` → PDFMake doc definition (pure builder) | ✅ built + tested     | —                |
| PDF bytes (PDFMake printer, embedded font)            | ✅ (infra)            | —                |
| QR image + branding images                            | ✅                    | —                |
| DRAFT watermark + status-gated export                 | ✅                    | —                |
| `ExportTranscript` use-case (from snapshot, audited)  | ✅                    | —                |
| **DOCX** rendering                                    | ⛔                    | Phase 14         |
| Template designer / batch export UI                   | ⛔                    | Phase 15 / shell |
| Pixel-faithful match to the real sample               | ⛔ (needs the sample) | when supplied    |

---

## Objectives

1. A **pure** `buildPdfDocDefinition(resolvedDoc, opts)` that maps the resolved
   block tree to a PDFMake document definition — fully unit-testable without
   generating bytes.
2. A `DocumentRendererPort` + **`PdfMakeRenderer`** (infra) that turns the doc
   definition into PDF **bytes** (PDFMake `PdfPrinter`, bundled font).
3. **QR + branding:** generate a QR image from `verification.qrPayload` and embed
   it; embed logo/seal/registrar-signature when the paths resolve (graceful if
   absent).
4. **DRAFT watermark** when status isn't APPROVED/LOCKED; **export gated** by
   `TranscriptRules.canExport` (official export requires APPROVED/LOCKED; a
   **preview** flag allows a watermarked DRAFT).
5. **`ExportTranscript`** use-case: load transcript → parse snapshot's
   `resolvedDoc` → render → audit `EXPORT` → return bytes + filename.

**Out of scope:** DOCX (P14), UI, pixel-faithful Template V1 (needs the sample).

---

## Deliverables

| #   | Deliverable                                                                                                                                               | Layer             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| D1  | `DocumentRendererPort` (`render(resolvedDoc, opts): Promise<Uint8Array>`)                                                                                 | app port          |
| D2  | `buildPdfDocDefinition(resolvedDoc, opts)` — pure ResolvedDoc → PDFMake docDefinition (incl. watermark, QR/branding placeholders)                         | domain/infra-pure |
| D3  | `PdfMakeRenderer` (infra) — docDefinition → PDF bytes via PDFMake `PdfPrinter` + bundled font                                                             | infra             |
| D4  | QR image generator (`qrcode`) + branding-image embedding (graceful on missing files)                                                                      | infra             |
| D5  | `ExportTranscript` use-case (`transcripts.read`/`transcripts.generate`): from snapshot, status-gated, audited; returns `{ bytes, filename, contentType }` | application       |
| D6  | `pdfmake` + `qrcode` dependencies                                                                                                                         | deps              |
| D7  | `scripts/demo-pdf.ts` — generate a transcript then export a real `.pdf` to disk (DRAFT watermarked + approved clean)                                      | scripts (dev)     |
| D8  | Tests (≥80%) — doc-definition builder (blocks → pdfmake nodes, watermark on DRAFT), export gating, snapshot-sourced                                       | tests             |
| D9  | `/docs` update + implementation notes                                                                                                                     | docs              |

---

## Architecture Decisions

- **AD13.1 — Pure builder, infra printer.** `buildPdfDocDefinition` is pure and
  unit-tested (block → pdfmake node, watermark logic); only `PdfMakeRenderer`
  touches the PDFMake printer + fonts + filesystem. Keeps rendering logic testable
  without byte diffing.
- **AD13.2 — Render from the snapshot, not live data.** `ExportTranscript` reads
  `Transcript.snapshot.resolvedDoc` — so an issued transcript re-exports with the
  same content forever, regardless of later record/template changes (ADR-006).
- **AD13.3 — Status gate + watermark.** Official export requires
  `TranscriptRules.canExport` (APPROVED/LOCKED). A `preview: true` export of a
  DRAFT is allowed but **watermarked "DRAFT — NOT VALID"**.
- **AD13.4 — Renderer behind a port.** PDF and DOCX (P14) both implement
  `DocumentRendererPort`; `ExportTranscript` is format-agnostic (takes a renderer).
- **AD13.5 — Graceful assets.** Missing branding images / QR failures degrade to
  text, never crash a legal document; embedded font makes output deterministic
  across machines.

---

## Database Changes

- **None.** Reads the existing `Transcript.snapshot`; export is audited via the
  existing audit log. No new permissions (`transcripts.read`/`generate` suffice).

---

## UI Screens

**None in Phase 13.** Future consumer (deferred): preview/download, batch export.

---

## Services / Use-cases (contracts, abridged)

- `DocumentRendererPort.render(resolvedDoc, opts): Promise<Uint8Array>`
- `buildPdfDocDefinition(resolvedDoc, opts): object` (pure)
- `ExportTranscript.execute({ transcriptId, preview? }, session): { bytes, filename, contentType }` → gated + audited

---

## Validation Rules

- Official export blocked unless `TranscriptRules.canExport(status)`; DRAFT export
  requires `preview` and carries the watermark.
- Snapshot must parse to a `ResolvedDoc`; a corrupt snapshot is an export error.
- Export authorized (fail-closed) + audited (`EXPORT`).

---

## Test Plan

| Test                   | Asserts                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------- |
| doc-definition builder | each block → expected pdfmake node (title/fieldGrid/courseTable/summary/qr placeholder) |
| watermark              | DRAFT → watermark present; APPROVED → absent                                            |
| export gating          | DRAFT official export rejected; preview allowed (watermarked); APPROVED exported        |
| from snapshot          | export uses the stored ResolvedDoc, not live data                                       |
| renderer smoke         | `PdfMakeRenderer` produces a non-empty PDF buffer (starts with `%PDF`)                  |
| coverage               | ≥80% on new code                                                                        |

Builder + gating tested headlessly; one renderer smoke test produces real bytes.

---

## Risks

| ID    | Risk                                        | Mitigation                                                                           |
| ----- | ------------------------------------------- | ------------------------------------------------------------------------------------ |
| P13-a | PDFMake fonts/printer setup in Node         | use the bundled Roboto via `PdfPrinter` font descriptors; smoke test in CI           |
| P13-b | Pixel-faithful match to the official sample | out of scope until the sample arrives; structure is faithful, layout iterates (F-30) |
| P13-c | Missing branding/QR assets crash render     | graceful degradation to text (AD13.5)                                                |
| P13-d | Large/batch exports memory                  | single transcript now; batch streaming is a shell concern                            |
| P13-e | `pdfmake`/`qrcode` supply chain             | pin versions; isolated behind the renderer/port                                      |

---

## Completion Criteria

- [ ] Pure doc-definition builder + PDF renderer + QR/branding + watermark +
      status-gated `ExportTranscript` (from snapshot) built, gated, audited.
- [ ] `demo:pdf` writes a real `.pdf` (DRAFT watermarked + approved clean).
- [ ] Tests pass; coverage ≥80% on new code; `tsc` strict clean; lint/format clean.
- [ ] Boundaries intact (builder pure; application never imports pdfmake; fitness test green).
- [ ] `/docs` updated; summary posted; **approval requested before Phase 14.**

---

## Approval Checklist (to start Phase 13 implementation)

- [ ] Scope confirmed: PDF renderer + status-gated `ExportTranscript`, render from snapshot.
- [ ] Add **`pdfmake` + `qrcode`** dependencies — OK?
- [ ] **DRAFT handling:** preview export allowed but **watermarked**; official export requires APPROVED/LOCKED — OK?
- [ ] Renderer behind `DocumentRendererPort` (DOCX is the P14 sibling) — OK.
- [ ] Go-ahead to implement.

_Related: [reporting-architecture.md](../phase-0/reporting-architecture.md) ·
[transcript-template-architecture.md](../phase-0/transcript-template-architecture.md) ·
[phase-12 implementation notes](../phase-12/implementation-notes.md) (ResolvedDoc / snapshot)_
