# Phase 10 — Spreadsheet Import

**Project:** EARTMP · **Phase:** 10 · **Status:** Plan drafted, awaiting approval
to implement · **Predecessor:** Phase 9 (implemented)

> Deliverables-before-implementation spec, in the mandated format. Nothing is
> built until you approve. Same proof model: headless domain/application logic,
> ≥80% coverage, dev adapters, runnable demo; UI + Tauri-SQL persistence deferred
> to the shell phase.

---

## Executive Summary

Phase 10 lets an operator **bulk-import results from a spreadsheet**. A SheetJS
reader turns an `.xlsx`/`.csv` into rows; the **`ImportResults`** use-case
**validates every row** (student exists by matric, course by code, component
scores present and in range, no in-file duplicates, target results not locked),
produces a **per-row error report**, and — only when every row is valid —
**atomically commits** the batch through the Phase 7 UnitOfWork. A **dry run**
validates and reports without writing, so the UI can preview before committing.
It reuses the Phase 9 scoring path (the configured `AssessmentStructure` computes
each final score) so manual entry and import produce identical results.

---

## Scope & sequencing

| Concern                                    | Phase 10          | Deferred to          |
| ------------------------------------------ | ----------------- | -------------------- |
| Spreadsheet parse (SheetJS) behind a port  | ✅                | —                    |
| Row validation + **error report**          | ✅ built + tested | —                    |
| Atomic commit of the valid batch (UoW)     | ✅                | —                    |
| **Dry-run** preview (validate, no write)   | ✅                | —                    |
| Per-course/programme assessment structures | ⛔ (uses default) | later                |
| Importing students/courses (vs results)    | ⛔                | later (same pattern) |
| UI upload wizard / Tauri-SQL persistence   | ⛔                | Shell phase          |

---

## Objectives

1. **Parse** a spreadsheet into raw rows behind a `SpreadsheetReaderPort` (so the
   use-case is testable with no files); a SheetJS implementation in infrastructure.
2. **Validate** each row and build an **`ImportReport`** (`{ totalRows, validRows,
errors: [{ row, messages }], imported }`): student resolves by matric, course
   by code, component scores parse + fall in range (via the assessment structure),
   no duplicate `(matric, course)` in the file, the existing result (if any) is
   not locked.
3. **Commit atomically**: when there are **zero errors** and it's not a dry run,
   write all valid rows in one transaction (all-or-nothing); on any error, write
   nothing and return the report.
4. **Dry run**: validate + report without writing.

**Out of scope:** UI, per-course structures, student/course import, Tauri-SQL.

---

## Deliverables

| #   | Deliverable                                                                                                                  | Layer         |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------------- |
| D1  | `SpreadsheetReaderPort` — `read(bytes): RawRow[]` (`RawRow = Record<string, string \| number>`)                              | app port      |
| D2  | `SheetJsReader` — SheetJS (`xlsx`) implementation (`.xlsx`/`.csv` → rows)                                                    | infra         |
| D3  | `ImportResults` use-case — validate rows → `ImportReport`; atomic commit of the valid batch via UoW; `dryRun` option         | application   |
| D4  | `ImportReport` + `RowError` types                                                                                            | application   |
| D5  | Reuse the Phase 9 scoring path (`GradingConfigService` + `AssessmentStructure`) + record reads (`findByMatric`/`findByCode`) | application   |
| D6  | `xlsx` (SheetJS) dependency added                                                                                            | deps          |
| D7  | `scripts/demo-import.ts` — import a valid batch + a batch with errors (report) + dry run                                     | scripts (dev) |
| D8  | Tests (≥80% coverage on new domain+application code) — validation matrix + atomicity + dry run                               | tests         |
| D9  | `/docs` update + implementation notes                                                                                        | docs          |

---

## Architecture Decisions

- **AD10.1 — Parsing is a port; validation is the use-case.** The use-case takes
  already-parsed rows, so all validation/commit logic is testable headlessly; the
  SheetJS impl is a thin infra adapter (defensive against malformed/huge files).
- **AD10.2 — All-or-nothing per import (with dry run).** A file commits only if
  **every** row is valid; otherwise nothing is written and the report lists every
  error. `dryRun` previews. This keeps a semester's data internally consistent —
  no half-imported batch. (Partial import can be added later if requested.)
- **AD10.3 — One scoring path.** Import computes each final score via the same
  configured `AssessmentStructure` as `EnterResult`, so import and manual entry
  agree exactly.
- **AD10.4 — Atomic commit via the UnitOfWork (F-1).** The valid batch writes in
  one transaction; for very large files the commit is **chunked** into bounded
  transactions (e.g. 500 rows) — `log`-style progress is a shell concern.
- **AD10.5 — Locked results are skipped with an error**, never silently
  overwritten (integrity, AD9.3).
- **AD10.6 — Defensive parsing.** The SheetJS reader caps file/row size and
  coerces cell types; untrusted input is fully validated before any write
  (security architecture §7).

---

## Database Changes

- **None to the schema shape** — imports write `Result` rows via the Phase 9 path.
- **Seed:** none new (`results.import` already seeded; granted to DATA_ENTRY).

---

## UI Screens

**None in Phase 10.** Future consumer (deferred): an import wizard (upload →
preview/report → commit).

---

## Services / Use-cases (contracts, abridged)

- `SpreadsheetReaderPort.read(bytes: Uint8Array): RawRow[]`
- `ImportResults.execute({ semesterId, rows, dryRun? }, session)` → `results.import`;
  returns `ImportReport`.
  - `ImportReport = { totalRows, validRows, imported, errors: { row: number; messages: string[] }[] }`

Column convention `[ASSUMPTION]` (confirm): `matricNumber`, `courseCode`, and one
column per assessment component key (e.g. `ca`, `exam`). The whole file targets
one `semesterId` (passed as input), not a per-row column.

---

## Validation Rules

- `matricNumber` present + resolves to a live student; `courseCode` present +
  resolves to a live course.
- Each component score numeric and within `0..maxScore` (the value object
  enforces); all defined components present.
- No duplicate `(matricNumber, courseCode)` within the file.
- The existing result for `(student, course, semester)`, if any, is **not locked**.
- Authorized (`results.import`, fail-closed); the commit is audited (one IMPORT
  entry summarising counts).

---

## Test Plan

| Test                             | Asserts                                                                     |
| -------------------------------- | --------------------------------------------------------------------------- |
| valid batch                      | all rows import; `imported === validRows`; final scores match the structure |
| unknown matric/course            | per-row error messages; nothing imported (all-or-nothing)                   |
| out-of-range / missing component | per-row error; report accurate                                              |
| in-file duplicate                | flagged as an error                                                         |
| locked target                    | error, not overwritten                                                      |
| dry run                          | validates + reports; `imported === 0`; no writes                            |
| atomicity                        | a mid-commit failure rolls back the whole batch (UoW)                       |
| coverage                         | ≥80% on new code                                                            |

Unit tests headless (fake reader / direct rows + in-memory fakes); the SheetJS
reader gets a small parse test against an in-memory workbook.

---

## Risks

| ID    | Risk                                          | Mitigation                                                                  |
| ----- | --------------------------------------------- | --------------------------------------------------------------------------- |
| P10-a | Malformed/huge files                          | defensive reader: size caps, type coercion, validate-before-write (AD10.6)  |
| P10-b | All-or-nothing too strict for big messy files | `dryRun` preview surfaces every error at once; partial import addable later |
| P10-c | 100k-row single transaction too heavy         | chunked transactions (AD10.4)                                               |
| P10-d | Column naming varies by institution           | convention documented + `[ASSUMPTION]`; a mapping layer can be added        |
| P10-e | SheetJS supply-chain / vulnerabilities        | pin version; parsing isolated behind the port; no formula execution         |

---

## Completion Criteria

- [ ] Parse → validate → report → atomic commit (+ dry run) built, gated, audited.
- [ ] All-or-nothing commit; locked results never overwritten; one scoring path.
- [ ] `demo:import` shows a clean import, an error report, and a dry run.
- [ ] Tests pass; coverage ≥80% on new code; `tsc` strict clean; lint/format clean.
- [ ] Boundaries intact (fitness test green).
- [ ] `/docs` updated; summary posted; **approval requested before Phase 11.**

---

## Approval Checklist (to start Phase 10 implementation)

- [ ] Scope confirmed: parse port + SheetJS impl + validating `ImportResults`, logic only.
- [ ] **All-or-nothing** commit + **dry-run** preview (vs partial import) — OK?
- [ ] Add the **`xlsx` (SheetJS)** dependency — OK?
- [ ] Column convention (`matricNumber`, `courseCode`, component-key columns; file = one semester) — OK / adjust?
- [ ] Go-ahead to implement.

_Related: [architecture-review.md](../phase-0/architecture-review.md) (F-1, security §7) ·
[phase-9 implementation notes](../phase-9/implementation-notes.md) (EnterResult / scoring path) ·
[reporting-architecture.md](../phase-0/reporting-architecture.md)_
