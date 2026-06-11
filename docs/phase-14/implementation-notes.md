# Phase 14 — Implementation Notes & Verification

**Status:** Implemented. All gates green. **Awaiting approval to start Phase 15.**

Approved: `DocxRenderer` on the existing `DocumentRendererPort`, reuse
`ExportTranscript`; add `docx` dep; DRAFT banner; PDF canonical, DOCX
content-faithful editable.

---

## Verification evidence (commands run)

| Gate                | Command                 | Result                                                                                               |
| ------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| Type-check          | `npm run typecheck`     | **clean**                                                                                            |
| Lint (+ boundaries) | `npm run lint`          | **0 errors**                                                                                         |
| Format              | `npm run format:check`  | **conforms**                                                                                         |
| Tests               | `npm run test:coverage` | **213 passed** (incl. real-`.docx` smoke); stmts **93.9%** · branch **85.3%** · funcs **88.2%**      |
| End-to-end demo     | `npm run demo:docx`     | ✓ DRAFT preview (banner, 9 KB, `PK=true`, docx content-type) · ✓ approved official (9 KB, `PK=true`) |

---

## What was built

- **`DocxRenderer`** (`infrastructure/reporting/docx/`) implementing the existing
  `DocumentRendererPort` — maps the same `ResolvedDoc` block tree to a `docx`
  `Document` (title/text/fieldGrid/courseTable/summary/remarks/signatureRow +
  **embedded QR image**) and returns `.docx` bytes via `Packer`. A **DRAFT
  banner** (`DRAFT — NOT VALID`, red, centered) stands in for a watermark (AD14.3).
- **`ExportTranscript` unchanged** — wired with the DOCX renderer +
  content-type/extension through its existing constructor params (the Phase 13
  port design pays off: PDF and DOCX diverge only in the renderer, AD14.1).
- `docx` dependency (+ `qrcode` reused). `scripts/demo-docx.ts`.
- **Tests:** `docx-renderer.smoke.test.ts` — real `.docx` (`PK` zip) bytes for a
  normal + watermarked render, and `ExportTranscript` with the DOCX renderer
  yielding `*.docx` filename + the docx content-type.

---

## Decisions honoured

- **Same port, second renderer** (AD14.1) — `ExportTranscript` not touched.
- **PDF canonical, DOCX editable** (AD14.2) — content-faithful, not pixel (F-30).
- **DRAFT banner** (AD14.3); **render from snapshot** + status gate inherited.
- **Application never imports `docx`** (AD14.4) — the boundary fitness test holds.
- No schema changes; no new permissions.

---

## Definition of Done (CLAUDE.md)

- [x] `DocxRenderer` on the existing port; `ExportTranscript` produces `.docx`
      (status-gated, from snapshot, audited) with no use-case change.
- [x] `demo:docx` writes a valid `.docx` (DRAFT banner + approved clean).
- [x] Tests pass (213); coverage ≥80% (93.9%); `tsc` strict clean; lint/format clean.
- [x] Boundaries intact (application never imports `docx`; fitness test green).
- [x] `/docs` updated; summary posted; approval requested before Phase 15.

_Next: Phase 15 — Transcript Template Designer (author/edit template layouts with
validation + versioning; the structured editor over the block grammar)._
