# Phase 13 — Implementation Notes & Verification

**Status:** Implemented. All gates green. **Awaiting approval to start Phase 14.**

Approved: PDF renderer + status-gated `ExportTranscript` (render from snapshot);
`pdfmake` + `qrcode` deps; DRAFT preview watermarked / official requires
APPROVED-LOCKED; renderer behind `DocumentRendererPort` (DOCX = P14 sibling).

---

## Verification evidence (commands run)

| Gate                | Command                 | Result                                                                                                                             |
| ------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Type-check          | `npm run typecheck`     | **clean**                                                                                                                          |
| Lint (+ boundaries) | `npm run lint`          | **0 errors**                                                                                                                       |
| Format              | `npm run format:check`  | **conforms**                                                                                                                       |
| Tests               | `npm run test:coverage` | **210 passed** (incl. real-PDF smoke test); stmts **93.9%** · branch **85.3%** · funcs **88.2%**                                   |
| End-to-end demo     | `npm run demo:pdf`      | ✓ DRAFT official export rejected · ✓ DRAFT **preview watermarked** (18 KB, `%PDF=true`) · ✓ approved official (18 KB, `%PDF=true`) |

---

## What was built

- **`DocumentRendererPort`** (`application/ports/`) — `render(resolvedDoc, opts)`;
  PDF now, DOCX (P14) is a sibling implementation (AD13.4).
- **`buildPdfDocDefinition`** (`infrastructure/reporting/pdf/`, **pure**) — maps
  each `ResolvedDoc` block (title/text/fieldGrid/courseTable/summary/remarks/
  signatureRow/qr) to a PDFMake node; adds the watermark when requested; embeds
  the QR image when a data URL is supplied (else a text fallback). No PDFMake
  import → unit-testable without bytes (AD13.1).
- **`PdfMakeRenderer`** (infra) — the only place touching the PDFMake printer +
  bundled Roboto font + `qrcode`. Generates the QR, builds the definition, streams
  PDF bytes. Deterministic font (AD13.5).
- **`ExportTranscript`** use-case (`transcripts.read`) — renders from the **frozen
  snapshot** (`AD13.2`), gated by `TranscriptRules.canExport` (official requires
  APPROVED/LOCKED; a `preview` DRAFT is **watermarked "DRAFT — NOT VALID"**),
  audited (`EXPORT`); returns `{ bytes, filename, contentType }`.
- `pdfmake` + `qrcode` deps (+ `@types/*`). `scripts/demo-pdf.ts`.
- **Tests:** `pdf-builder.test.ts` (blocks → nodes, QR fallback, watermark),
  `export-transcript.test.ts` (gating: DRAFT rejected / preview watermarked /
  APPROVED clean / corrupt snapshot / missing), `pdf-renderer.smoke.test.ts`
  (**real** `%PDF` bytes + watermark).

---

## Decisions honoured

- **Render from snapshot, not live data** (AD13.2) — re-export is content-stable.
- **Status gate + watermark** (AD13.3) — proven in the demo + tests.
- **Pure builder / infra printer** (AD13.1) — application never imports `pdfmake`
  (boundary intact); the QR/PDF live only in the renderer.
- **Renderer behind a port** (AD13.4) — DOCX slots in next.
- No schema changes; no new permissions; pixel-faithful Template V1 still pending
  the real sample (F-30), structure is faithful.

---

## Definition of Done (CLAUDE.md)

- [x] Pure doc-definition builder + PDF renderer + QR/watermark + status-gated
      `ExportTranscript` (from snapshot) built, gated, audited.
- [x] `demo:pdf` writes real PDF bytes (DRAFT watermarked + approved clean).
- [x] Tests pass (210); coverage ≥80% (93.9%); `tsc` strict clean; lint/format clean.
- [x] Boundaries intact (application never imports `pdfmake`; fitness test green).
- [x] `/docs` updated; summary posted; approval requested before Phase 14.

_Next: Phase 14 — Reporting: DOCX (a `DocxRenderer` implementing the same
`DocumentRendererPort` from the same ResolvedDoc; `ExportTranscript` stays
format-agnostic)._
