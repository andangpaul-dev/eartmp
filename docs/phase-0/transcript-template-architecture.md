# Transcript Template Architecture

**Project:** EARTMP · **Phase:** 0 · **Status:** Draft, awaiting approval

> **⚠ Post-review revision (2026-06-08) — see
> [architecture-review.md](architecture-review.md).** Reproducibility gap (F-28):
> `Transcript.snapshot` freezes the **data** but not the **layout** — if a
> template is edited/deleted the historical rendering is lost. The snapshot must
> also capture the **resolved layout** (or the final rendered PDF bytes + hash).
> Verification should be a **digital signature**, not a plain hash (F-14). The
> `layout` DSL is intentionally minimal — see F-29 for its known limits.

This document specifies the **template format** that makes transcript layouts
data, not code. The supplied transcript sample is to be implemented as
**Transcript Template Version 1**, but _no layout is ever hardcoded_ — V1 is a
row in `TranscriptTemplate`, not a code path. Pairs with
[reporting-architecture.md](reporting-architecture.md) (the rendering engine).

> `[ASSUMPTION]` The actual transcript sample image/file was not present in the
> repo. The format below is general enough to express a standard academic
> transcript; the concrete V1 layout JSON will be authored against the real
> sample when supplied.

---

## 1. Goals

1. **Zero hardcoded fields.** Branding, student info, session data, course
   tables, GPA summaries, remarks, signatures, QR — all bound from data.
2. **Versioned & reusable.** `TranscriptTemplate.version` lets a template evolve
   while previously issued transcripts remain reproducible (they store the
   snapshot, not a template reference for rendering history).
3. **Institution-portable.** A new institution supplies its own template JSON +
   branding; no code change.
4. **Multiple document types** from one mechanism: `RESULT_SLIP`,
   `ACADEMIC_TRANSCRIPT`, `STATEMENT`, `GRADUATION_REPORT`.

---

## 2. Where templates live

- **`TranscriptTemplate`** table: `name` (UK), `version`, `layout` (JSON),
  `isDefault`. The `layout` column is the entire template definition.
- **Branding** comes from `Institution` (logo/seal/registrar signature paths,
  name, motto, accreditation no.) — referenced by the template, not embedded, so
  one template serves re-branding.
- **Issued `Transcript`** stores a `snapshot` (frozen resolved data) +
  `verificationHash` so it is reproducible independent of later template/record
  changes.

---

## 3. Template document model (the `layout` JSON)

A template is an **ordered tree of typed blocks**. Each block declares its type,
data bindings (paths into `ReportData`), and presentation hints. The renderer
(see reporting-architecture §2) walks this tree.

`[ASSUMPTION]` proposed schema:

```jsonc
{
  "schemaVersion": 1,
  "pageSize": "A4",
  "margins": [40, 60, 40, 60],
  "styles": { "h1": { "fontSize": 16, "bold": true }, "th": { "bold": true } },
  "blocks": [
    {
      "type": "header",
      "children": [
        { "type": "image", "bind": "institution.logoPath", "width": 64 },
        { "type": "text", "bind": "institution.name", "style": "h1" },
        { "type": "text", "bind": "institution.motto", "style": "muted" },
        {
          "type": "text",
          "template": "Accreditation: {{institution.accreditationNo}}",
        },
      ],
    },
    { "type": "title", "value": "ACADEMIC TRANSCRIPT" },
    {
      "type": "fieldGrid",
      "columns": 2,
      "fields": [
        { "label": "Name", "bind": "student.fullName" },
        { "label": "Matric No.", "bind": "student.matricNumber" },
        { "label": "Programme", "bind": "student.programme" },
        { "label": "Department", "bind": "student.department" },
      ],
    },
    {
      "type": "sessionLoop",
      "bind": "sessions",
      "block": {
        "type": "courseTable",
        "groupHeading": "template:{{session}} — {{semester}}",
        "columns": [
          { "header": "Code", "bind": "code" },
          { "header": "Course Title", "bind": "title" },
          { "header": "Credit", "bind": "creditValue", "align": "center" },
          { "header": "Score", "bind": "finalScore", "align": "center" },
          { "header": "Grade", "bind": "grade", "align": "center" },
          { "header": "GP", "bind": "gradePoint", "align": "center" },
        ],
        "footer": [
          { "label": "Semester GPA", "bind": "semesterGpa" },
          { "label": "Credits Earned", "bind": "creditsEarned" },
        ],
      },
    },
    {
      "type": "summary",
      "fields": [
        { "label": "CGPA", "bind": "summary.cgpa" },
        {
          "label": "Total Credits Earned",
          "bind": "summary.totalCreditsEarned",
        },
        { "label": "Class of Standing", "bind": "summary.standing" },
      ],
    },
    { "type": "remarks", "bind": "remarks" },
    {
      "type": "signatureRow",
      "bind": "signatures",
      "item": {
        "name": "{{name}}",
        "role": "{{role}}",
        "image": "{{imagePath}}",
      },
    },
    {
      "type": "qr",
      "bind": "verification.qrPayload",
      "caption": "verification.transcriptNumber",
    },
  ],
}
```

### 3.1 Block-type catalogue (initial)

| Block                       | Purpose                                                  |
| --------------------------- | -------------------------------------------------------- |
| `header` / `image` / `text` | branding band                                            |
| `title`                     | document title (per `type`)                              |
| `fieldGrid`                 | labelled student/info fields in N columns                |
| `sessionLoop`               | repeat a child block over `ReportData.sessions`          |
| `courseTable`               | dynamic results table with configurable columns + footer |
| `summary`                   | CGPA / credits / standing block                          |
| `remarks`                   | free-text remarks                                        |
| `signatureRow`              | repeating signatures (name/role/image)                   |
| `qr`                        | QR verification block                                    |
| `spacer` / `divider`        | layout helpers                                           |

New block types are added in infrastructure (a renderer fragment) — but the
_existence_ of a block in a transcript is always a template decision.

---

## 4. Binding language

- **`bind`**: a dotted path into `ReportData` (`student.fullName`,
  `summary.cgpa`). Inside loops, paths are relative to the iterated item.
- **`template`/`value`**: literal text with `{{path}}` interpolation for mixed
  static/dynamic strings.
- **Formatting hints:** `style` (named style), `align`, number formatting
  (`"format": "0.00"` for GPA) — presentation only, no business logic.
- **Missing-data policy:** optional binds render empty/omit; required binds
  missing → validation error at generation (not a silent blank on a legal
  document).

---

## 5. Validation

- The `layout` JSON is validated by a **template validator** (Zod schema for the
  block grammar) on save and on load: unknown block types, malformed binds, or a
  `courseTable` with no columns are rejected.
- Bind paths are checked against the known `ReportData` shape so a typo
  (`studnet.fullName`) fails fast rather than printing blank.
- This mirrors the domain principle that configuration is validated before use
  ([coding-standards.md](coding-standards.md) §5).

---

## 6. Versioning & lifecycle

- **Authoring:** Template V1 is seeded from the supplied sample. A template
  designer UI (later phase) edits the JSON via a structured editor, not raw text.
- **Versioning:** editing a published template bumps `version`; old issued
  transcripts are unaffected (they carry their snapshot). `isDefault` marks the
  active template for new issuances.
- **Multiple templates:** institutions can keep distinct templates per document
  `type` (slip vs full transcript vs graduation report).

---

## 7. Mapping Template V1 to the sample `[ASSUMPTION]`

When the real sample arrives, produce V1 by:

1. Identifying every static label vs dynamic field on the sample.
2. Mapping each dynamic field to a `ReportData` path (extend the DTO if needed).
3. Expressing the visual structure as the block tree (§3).
4. Generating a golden-master render and comparing to the sample pixel/section by
   section.
5. Storing the result as `TranscriptTemplate{name:"Official Transcript",
version:1, isDefault:true, layout:<json>}` via the seed.

---

## 8. Open items for spec reconciliation

- `[ASSUMPTION]` Entire concrete V1 layout — pending the supplied sample.
- `[ASSUMPTION]` Block-type catalogue completeness (e.g. grade-key legend,
  page-break rules, continuation headers).
- `[ASSUMPTION]` Number/date formatting locale.

_Related: [reporting-architecture.md](reporting-architecture.md) ·
[database-design.md](database-design.md) ·
[solution-architecture.md](solution-architecture.md)_
