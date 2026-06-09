# Reporting Architecture

**Project:** EARTMP · **Phase:** 0 · **Status:** Draft, awaiting approval

Reporting in EARTMP is **template-driven**: no document layout is hardcoded.
This document defines the rendering pipeline, the PDF/DOCX engines, the data
model that flows into a report, QR verification, and how reproducibility is
guaranteed. It pairs with
[transcript-template-architecture.md](transcript-template-architecture.md),
which specifies the template _format_; this doc specifies the _engine_.

---

## 1. Reporting requirements

- **Outputs:** Academic Transcript, Result Slip, Statement of Results,
  Graduation Report (the `Transcript.type` enum), plus operational reports
  (cohort lists, audit export). All driven by templates/config, none hardcoded.
- **Formats:** **PDF** (canonical issued document) and **DOCX** (editable).
- **Dynamic everything:** institution branding, student info, session data,
  course tables, GPA/CGPA summaries, remarks, signatures — all bound at render
  time from data. (Master prompt "no transcript fields may be hardcoded.")
- **Verifiable & reproducible:** every issued transcript carries a QR/hash and
  is reproducible from a frozen snapshot.

---

## 2. The rendering pipeline

```
  Use-case (application)          Infrastructure (reporting)
  ────────────────────           ─────────────────────────────
  GenerateTranscript
    1. gather data  ──────────▶  ReportData (pure DTO)
       (student, results,            │
        GPA/CGPA, institution,       │
        remarks, signatures)         ▼
    2. load template  ─────────▶  TranscriptTemplate.layout (JSON)
    3. freeze snapshot  ◀───────  bind(ReportData, layout) → ResolvedDoc
    4. compute hash + QR                       │
    5. persist Transcript           ┌──────────┴──────────┐
       (snapshot, hash, number)     ▼                     ▼
                              PdfRenderer            DocxRenderer
                              (PDFMake docDef)       (docx model)
                                     │                     │
                                     ▼                     ▼
                                  .pdf file            .docx file
```

Key idea: a **template (JSON layout) + report data → a resolved document model**,
which is then handed to format-specific renderers. The binding step is
format-agnostic; only the final renderers know PDFMake/DOCX.

### 2.1 Ports & layers

- **`DocumentRendererPort`** (application port): `render(resolvedDoc, format) →
bytes`. Keeps use-cases free of PDFMake/DOCX.
- **Infrastructure** provides `PdfMakeRenderer` and `DocxRenderer` implementing
  the port. The `GenerateTranscript` use-case depends only on the port +
  `TranscriptRepository` + `AuditLogPort`.
- The **binder** (template JSON + data → resolved doc) lives in
  `infrastructure/reporting` but is pure and unit-testable.

---

## 3. ReportData (the dynamic data contract)

A pure DTO assembled by the use-case; the single source of truth a template binds
to. `[ASSUMPTION]` shape (refine against the real transcript sample):

```ts
interface ReportData {
  institution: {
    name;
    motto?;
    accreditationNo?;
    address?;
    logoPath?;
    sealPath?;
    registrarSignPath?;
  };
  student: {
    matricNumber;
    regNumber?;
    fullName;
    programme;
    department;
    faculty?;
    level?;
    admissionSession?;
    photoPath?;
  };
  sessions: Array<{
    // grouped academic history
    session: string;
    semester: string;
    courses: Array<{
      code;
      title;
      creditValue;
      finalScore?;
      grade;
      gradePoint;
      creditsEarned;
    }>;
    semesterGpa: number;
    creditsAttempted: number;
    creditsEarned: number;
  }>;
  summary: {
    cgpa: number;
    totalCreditsEarned;
    totalCreditsRequired?;
    standing: string;
  };
  remarks?: string;
  signatures: Array<{ role: string; name?: string; imagePath?: string }>;
  verification: { transcriptNumber; hash; qrPayload };
  issuedAt: string;
}
```

GPA/CGPA values come straight from `GpaEngine` (`semesterGpa`, aggregate `cgpa`,
configurable `standing`) — the report layer never recomputes them.

---

## 4. PDF rendering (PDFMake)

- PDFMake consumes a **declarative document definition** (a JS object: content,
  styles, tables, images, columns). This maps cleanly from our resolved-doc
  model — a template component → a PDFMake fragment.
- Capabilities used: header/footer with institution branding, image embedding
  (logo/seal/signature), multi-column student-info blocks, **repeating course
  tables** per session/semester, summary blocks, page numbering, watermark for
  `DRAFT` status.
- **Fonts:** embed required fonts (PDFMake vfs) so output is identical on every
  machine (offline-deterministic).
- The QR image is rendered into a fixed region from the verification payload.

## 5. DOCX rendering

- The `docx` library builds an editable Word document from the same resolved-doc
  model — a parallel renderer, not a PDF-to-DOCX conversion.
- Used when institutions need to hand-edit before issuing; the canonical issued
  copy remains the PDF with its hash.

---

## 6. QR verification & reproducibility

- **Verification hash:** computed over the frozen `Transcript.snapshot` (e.g.
  SHA-256). Stored in `Transcript.verificationHash`.
- **QR payload:** encodes `{transcriptNumber, hash}` (and optionally an offline
  verification instruction). A verifier screen in the app re-reads the snapshot
  by number, recomputes the hash, and confirms it matches — detecting tampering.
  `[ASSUMPTION]` no external/online verification endpoint in v1 (offline-first).
- **Reproducibility:** because the snapshot is frozen at generation, re-rendering
  an issued transcript yields the identical document even if underlying records
  later change. Re-issue uses the snapshot, not live data.
- **Transcript numbering:** `Institution.transcriptNumberRule` +
  `TranscriptRepository.nextTranscriptNumber(rule)` produce unique, formatted
  numbers (`Transcript.transcriptNumber` UK).

---

## 7. Status gating (security tie-in)

- Only `APPROVED`/`LOCKED` transcripts may be exported
  (`TranscriptRules.canExport`); `DRAFT` exports, if allowed for preview, are
  watermarked "DRAFT — NOT VALID". Enforced in the use-case, mirrored in UI.
- Export is an audited action (`AuditLog{action: EXPORT}`).
  See [security-architecture.md](security-architecture.md) §4.

---

## 8. Performance & batching

- **Batch generation** (e.g. a whole cohort) streams documents and reuses the
  bound template; rendering runs off the UI thread with progress reporting.
- Image assets (logo/seal/signatures) are cached per institution to avoid
  re-reading from disk per document.

---

## 9. Testing strategy

- **Binder unit tests:** template JSON + sample `ReportData` → expected
  resolved-doc structure (no PDF generation needed).
- **Golden-master tests:** a fixed `ReportData` + Template V1 → snapshot of the
  PDFMake docDefinition / DOCX model; diffs flag unintended layout changes.
- **Hash/QR tests:** snapshot → stable hash; tampered snapshot → mismatch.
- **No hardcoding test:** swapping the template JSON changes the output without
  code changes — proves template-driven design.

---

## 10. Open items for spec reconciliation

- `[ASSUMPTION]` Exact `ReportData` shape and field set — pending the real
  transcript sample (Template V1).
- `[ASSUMPTION]` Hash algorithm and QR payload format (§6).
- `[ASSUMPTION]` Which operational reports beyond transcripts are required.

_Related: [transcript-template-architecture.md](transcript-template-architecture.md) ·
[security-architecture.md](security-architecture.md) ·
[solution-architecture.md](solution-architecture.md)_
