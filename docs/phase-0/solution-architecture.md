# Solution Architecture Document (SAD)

**Project:** EduCore Academic Records & Transcript Management Platform (EARTMP)
**Phase:** 0 — Solution Design
**Status:** Draft, awaiting approval
**Audience:** Architects, lead engineers, reviewers

---

## 1. Executive Summary

EARTMP is an **offline-first desktop application** that lets an educational
institution manage academic structures, student records, course registries,
assessment configuration, results processing, GPA/CGPA computation, template-
driven transcripts, graduation eligibility, audit logging, and backup/recovery —
**without source-code changes when the institution's rules differ.**

The defining architectural constraints are:

1. **Offline-first.** All data lives in a local SQLite database; the app must be
   fully functional with no network. Nothing depends on a server round-trip.
2. **Configuration over code.** Grading scales, assessment structures, and
   transcript layouts are _data_ (JSON in DB rows), not hardcoded logic. A new
   institution is onboarded by editing configuration, never the codebase.
3. **Clean Architecture + DDD.** Dependencies point inward only. The domain
   core is provably framework-free (its tests run under plain Vitest with no DB,
   no React, no Prisma) — this is already demonstrated in
   `reference-implementation/`.

This document defines the layers, their responsibilities, the technology
choices with rationale, the runtime/process model, cross-cutting concerns, and
the key architectural risks.

---

## 2. Architectural Drivers

### 2.1 Functional drivers

- Multi-institution support **without recompilation** (grade scales, assessment
  schemes, transcript templates are runtime data).
- Bulk results import (spreadsheets) with validation and an error report.
- Deterministic, auditable GPA/CGPA computation.
- Template-driven transcript generation (PDF + DOCX) with QR verification.
- Graduation eligibility evaluation against configurable rules.

### 2.2 Quality-attribute drivers (prioritised)

| Priority | Attribute                | Driver                                                                     |
| -------- | ------------------------ | -------------------------------------------------------------------------- |
| 1        | **Correctness**          | Academic records are legal/permanent records; a wrong GPA is unacceptable. |
| 2        | **Configurability**      | One binary serves many institution types.                                  |
| 3        | **Auditability**         | Every write to records must be traceable (who/what/when).                  |
| 4        | **Data durability**      | Soft deletes, backups, restore; no silent data loss.                       |
| 5        | **Offline availability** | Works with zero connectivity.                                              |
| 6        | **Performance**          | 10,000+ students, 100,000+ results must remain responsive.                 |
| 7        | **Security**             | RBAC, hashed credentials, encrypted backups.                               |
| 8        | **Maintainability**      | Clean layering; domain testable in isolation.                              |

### 2.3 Constraints

- Mandatory stack (see §4). Tauri 2 desktop shell; SQLite single-file DB.
- No application code before Phase approval (BSD §11).
- Single-user-per-machine assumed for v1, but data model anticipates multi-user
  (RBAC tables exist).

---

## 3. Architecture Overview

EARTMP uses **Clean Architecture** with four concentric layers. The dependency
rule is absolute: **source dependencies point inward only.**

```
        ┌─────────────────────────────────────────────────────┐
        │  Presentation  (React 19 + Tauri shell)              │
        │  ShadCN UI · TanStack Query · RHF + Zod              │
        │  ┌───────────────────────────────────────────────┐  │
        │  │  Application  (use-cases / services)          │  │
        │  │  ProcessSemesterResults, ImportResults, ...   │  │
        │  │  ┌─────────────────────────────────────────┐  │  │
        │  │  │  Domain  (entities, VOs, services)      │  │  │
        │  │  │  GradeScale · AssessmentStructure ·     │  │  │
        │  │  │  GpaEngine · repository PORTS           │  │  │
        │  │  └─────────────────────────────────────────┘  │  │
        │  └───────────────────────────────────────────────┘  │
        │  Infrastructure  (Prisma/SQLite, SheetJS, PDFMake,  │
        │  DOCX, QR, backup, Argon2)  — implements PORTS      │
        └─────────────────────────────────────────────────────┘
```

> Infrastructure sits in the outer ring even though the diagram draws it at the
> bottom: it _implements_ interfaces owned by the inner layers (dependency
> inversion). The domain never names a concrete infrastructure type.

### 3.1 Layer responsibilities

#### Domain layer (`src/domain/`)

The heart. Pure TypeScript, **imports nothing from outer layers, no framework,
no I/O.**

- **Value objects:** `GradeScale` (validated mark→grade bands),
  `AssessmentStructure` (weighted components summing to 100). Both reject
  invalid configuration at construction so a misconfigured institution cannot
  silently produce ungradeable marks.
- **Services:** `GpaEngine` — credit-weighted GPA, cumulative CGPA computed over
  _aggregate quality points and credits_ (not a mean of semester GPAs, which is
  wrong under uneven credit loads), and configurable academic standing.
- **Entities:** framework-free `Student`, `Course`, `ResultRecord`,
  `Transcript` plus invariant helpers (`StudentRules`, `TranscriptRules`).
- **Repository ports:** interfaces (`StudentRepository`, `ResultRepository`, …)
  and the append-only `AuditLogPort`. These are the dependency-inversion seam.

_Verification of purity:_ the domain compiles and tests under Vitest with no DB
and no React. This is an enforced invariant, not an aspiration (see
[coding-standards.md](coding-standards.md) §"Architecture fitness").

#### Application layer (`src/application/`)

Orchestrates the domain against ports. Holds **use-cases** (one class per
business operation), e.g. `ProcessSemesterResults`, future `ImportResults`,
`GenerateTranscript`, `EvaluateGraduation`. Use-cases:

- depend on **repository interfaces only**, never Prisma;
- enforce cross-entity workflow rules and transactions;
- write audit entries via `AuditLogPort`.

#### Infrastructure layer (`src/infrastructure/`)

The only layer that talks to the outside world:

- **Prisma repositories** implementing the domain ports against SQLite.
- **Import** (`SheetJS`) — spreadsheet → validated rows → error report.
- **Reporting** (`PDFMake`, `docx`) — template JSON → document.
- **Crypto** (`Argon2` hashing, backup encryption), **QR** generation,
  **backup/restore** (compressed SQLite copy + USB export).

#### Presentation layer (`src/presentation/`)

React 19 + Tauri. **Never touches the database directly.** All data flows
through application services exposed via Tauri commands / an IPC façade.

- ShadCN UI components, Tailwind styling.
- TanStack Query for server-state caching of use-case results.
- React Hook Form + Zod for form state and input validation (Zod schemas mirror
  domain invariants but do not replace them).

### 3.2 The dependency-inversion seam (worked example)

`ProcessSemesterResults` (application) needs results and courses. It declares
constructor dependencies on `ResultRepository`, `CourseRepository`,
`AuditLogPort` — all **domain-owned interfaces**. At composition time
(infrastructure/DI), Prisma-backed implementations are injected. The use-case
test injects in-memory fakes and runs with no database. That test passing is the
architectural proof that UI→DB and domain→framework coupling does not exist.

---

## 4. Technology Decisions & Rationale

| Concern            | Choice                           | Rationale                                                                                     | Trade-off / risk                                                                  |
| ------------------ | -------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Desktop shell      | **Tauri 2**                      | Tiny binary, native webview, Rust security model, good offline story vs Electron's footprint. | Smaller ecosystem; some native features need Rust glue.                           |
| UI                 | **React 19 + TypeScript + Vite** | Mandated; mature, typed, fast HMR.                                                            | —                                                                                 |
| Styling/components | **Tailwind + ShadCN UI**         | Accessible, ownable components (copy-in, not a black-box dep).                                | Design discipline required to stay consistent.                                    |
| Server-state       | **TanStack Query**               | Cache/invalidation for use-case results, even though "server" is local IPC.                   | Slight conceptual overhead for a local app.                                       |
| Forms/validation   | **React Hook Form + Zod**        | Typed schemas, minimal re-renders; Zod doubles as a DTO contract.                             | Must keep Zod and domain invariants in sync (domain is source of truth).          |
| Persistence        | **SQLite**                       | Single-file, offline-first, zero-admin, ACID; ideal for desktop.                              | Single-writer; large-write batching needed for import.                            |
| ORM                | **Prisma 7**                     | Typed client, migrations, schema as source of truth.                                          | Client generation/migration needs network to Prisma's binary host (see risk R-3). |
| Import             | **SheetJS**                      | De-facto standard for xlsx/csv parsing.                                                       | Must guard against malformed/huge files.                                          |
| Reporting          | **PDFMake + docx**               | Declarative doc definitions → maps cleanly from template JSON; DOCX for editable output.      | Pixel-faithful reproduction of a sample needs care.                               |
| Hashing            | **Argon2**                       | Memory-hard password hashing, current best practice.                                          | Tuning cost params for desktop CPUs.                                              |
| Verification       | **QR codes**                     | Offline-verifiable transcript hash.                                                           | Verifier UX must be defined.                                                      |
| Testing            | **Vitest + RTL**                 | Fast, ESM-native, matches Vite.                                                               | —                                                                                 |

---

## 5. Runtime & Process Model

- **Single desktop process** with the Tauri Rust core and the React webview.
- **One SQLite database file** (`DATABASE_URL=file:./dev.db` in dev; an
  app-data path in production).
- **IPC boundary:** the React UI invokes application use-cases through a thin
  command façade (Tauri commands or an in-process service registry). Use-cases
  run in the JS/TS runtime; Prisma talks to SQLite.
- **Concurrency:** SQLite is single-writer. Bulk import and results processing
  run as **batched transactions**; the UI shows progress and stays responsive
  via async use-case calls.
- **Record locking:** `Result.isLocked` and `Transcript.status` gate mutation;
  a locked result/approved transcript is immutable except via an explicit,
  audited unlock workflow.

---

## 6. Cross-Cutting Concerns

| Concern             | Approach                                                                                                                              | Owning layer | Detail doc                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------- |
| **Security / RBAC** | Argon2 hashing, role→permission grants, permission checks at the use-case boundary.                                                   | App + Infra  | [security-architecture.md](security-architecture.md)                       |
| **Auditing**        | Append-only `AuditLogPort.record()` on every state-changing use-case; immutable `AuditLog` table (no update/delete).                  | App + Infra  | [security-architecture.md](security-architecture.md)                       |
| **Validation**      | Zod at the UI edge; domain value objects as the authoritative invariant guard; DB constraints as the last line.                       | All          | [coding-standards.md](coding-standards.md)                                 |
| **Configuration**   | Grade scales, assessment structures, transcript layouts, settings stored as JSON rows; loaded at runtime.                             | Infra→Domain | [transcript-template-architecture.md](transcript-template-architecture.md) |
| **Soft delete**     | `deletedAt` on every mutable table; repositories filter it out by default.                                                            | Infra        | [database-design.md](database-design.md)                                   |
| **Backup/restore**  | Compressed (and encrypted) SQLite copy, manual/scheduled, USB export.                                                                 | Infra        | [security-architecture.md](security-architecture.md)                       |
| **Reporting**       | Template JSON → PDFMake/DOCX document model.                                                                                          | Infra        | [reporting-architecture.md](reporting-architecture.md)                     |
| **Error handling**  | Typed domain errors (`GradeScaleError`, `AssessmentError`); use-cases translate to user-facing results; UI shows actionable messages. | All          | [coding-standards.md](coding-standards.md)                                 |

---

## 7. Data Architecture (summary)

23 tables across seven concerns: Auth/RBAC, Institution/Settings, Academic
structure, Students/Courses, Assessment/Grading config, Results, Transcripts/
Templates, and Audit/Backup/Notifications. Every mutable table carries
`createdAt`/`updatedAt`/`deletedAt`; `AuditLog` is intentionally append-only.
Variable rules live as JSON (`GradeScale.bands`, `AssessmentConfig.components`,
`TranscriptTemplate.layout`, `Setting.value`). Full detail:
[erd.md](erd.md) and [database-design.md](database-design.md).

---

## 8. Architectural Decisions (ADR-style log)

- **ADR-001 — Clean Architecture with a framework-free domain.** _Accepted._
  Domain testability with no DB/UI is the correctness guarantee. Cost: more
  boilerplate (ports + mappers). Justified by the permanence of academic data.
- **ADR-002 — Configuration as data, not code.** _Accepted._ Grade/assessment/
  transcript rules are JSON rows validated by value objects. Enables multi-
  institution without recompiling. Cost: a validation layer for config.
- **ADR-003 — SQLite + Prisma over a client/server DB.** _Accepted._ Offline-
  first mandate. Cost: single-writer; mitigated by batched transactions.
- **ADR-004 — CGPA by aggregate quality points, not mean of GPAs.** _Accepted._
  Mathematically correct under uneven credit loads; encoded and tested in
  `GpaEngine.computeCumulative`.
- **ADR-005 — Append-only audit log.** _Accepted._ `AuditLog` has no
  `updatedAt`/`deletedAt`; modelled as `AuditLogPort`, not a CRUD repository.
- **ADR-006 — Snapshot transcripts.** _Accepted._ `Transcript.snapshot` freezes
  rendered data at generation time so a re-issued transcript is reproducible even
  if later records change; `verificationHash` binds the snapshot. _Amended
  (post-review, F-28):_ the snapshot also captures the **resolved layout** (or
  final PDF bytes + hash) so historical rendering survives template edits.
- **ADR-007 — Data layer: Tauri SQL plugin at runtime, Prisma dev-time only.**
  _Accepted (post-review, resolves F-0)._ Prisma (Node) cannot run inside the
  Tauri (Rust) app, so Prisma is kept **only** for authoring/versioning the
  SQLite schema and generating migrations; the **runtime repositories** are
  implemented against `tauri-plugin-sql`/`sqlx` in the Rust core. The domain
  depends on repository _ports_, so this swap touches only `infrastructure/`.
- **ADR-008 — Encrypt the primary DB at rest (SQLCipher).** _Accepted
  (post-review, resolves F-12)._ The live database is encrypted (SQLCipher / the
  Tauri SQL plugin's encryption), keyed from the operator passphrase — not just
  backups.
- **ADR-009 — Transcript verification by digital signature.** _Accepted
  (post-review, resolves F-14)._ The snapshot is signed with the institution's
  **private key**; the QR carries the signature; verification uses the public key
  and needs no database. Replaces the self-referential hash.
- **ADR-010 — Bundled schema revision before Phase 5.** _Accepted
  (post-review)._ A single revised-schema migration adds grade-scale/assessment
  **provenance on `Result`** (F-19), **enrollment history** (F-22),
  **course-offering vs definition** (F-23), an optimistic-lock **`version`**
  column (F-27), **FK indexes** (F-26), **`schemaVersion`** in config JSON
  (F-25), and enum **CHECK constraints** (F-24) — reviewed before Phase 5.
- **ADR-011 — Transactional use-cases + fail-closed authorization.** _Accepted
  (post-review, F-1/F-13)._ Every multi-write use-case runs inside a `UnitOfWork`
  transaction; a mandatory authorization decorator denies by default unless the
  use-case declares its required permissions.

---

## 9. Risks & Mitigations

| ID   | Risk                                                                                                | Impact       | Likelihood | Mitigation                                                                                                                                                                       |
| ---- | --------------------------------------------------------------------------------------------------- | ------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1  | Authoritative SDP/SST/BSD absent; docs reconstructed from artifacts.                                | Medium       | Certain    | All inferences marked `[ASSUMPTION]`; reconcile when specs arrive.                                                                                                               |
| R-2  | Wrong GPA/CGPA formula for a given institution.                                                     | High         | Low        | Configurable engine + golden-master tests per institution profile.                                                                                                               |
| R-3  | Prisma client/migration needs network to its binary host.                                           | Medium       | Med        | Document offline binary caching; run `prisma generate` in a connected env (see [environment-setup.md](environment-setup.md)).                                                    |
| R-4  | Pixel-faithful transcript reproduction harder than expected.                                        | Medium       | Med        | Template architecture decouples layout from data; iterate on Template V1.                                                                                                        |
| R-5  | SQLite single-writer bottleneck on 100k-row import.                                                 | Medium       | Med        | Batched transactions, indexes, progress UI, off-main-thread work.                                                                                                                |
| R-6  | Config JSON drift vs value-object invariants.                                                       | Medium       | Med        | Validate JSON through the value objects on load; reject on mismatch.                                                                                                             |
| R-7  | Backup encryption key management on a desktop.                                                      | High         | Med        | Define key handling in security architecture; never store key in plaintext beside backup.                                                                                        |
| R-8  | **Prisma (Node) cannot run inside the Tauri (Rust) app** — data layer has no runtime once packaged. | **Critical** | Certain    | Resolve via the data-layer decision (Option A: Tauri SQL plugin runtime + Prisma for dev-time schema/migrations). See [architecture-review.md](architecture-review.md) §0 (F-0). |
| R-9  | Non-atomic multi-write use-cases corrupt records on partial failure.                                | High         | Med        | Introduce a `UnitOfWork`/transaction port; every multi-write use-case runs atomically (F-1).                                                                                     |
| R-10 | Primary DB unencrypted → device theft exposes all PII.                                              | High         | Med        | Encrypt DB at rest (SQLCipher / Tauri SQL encryption) or mandate full-disk encryption (F-12).                                                                                    |
| R-11 | Authorization holes from use-cases that forget the permission check.                                | High         | Med        | Mandatory fail-closed authz decorator around every use-case (F-13).                                                                                                              |
| R-12 | Transcript verification is a self-referential hash, not third-party-verifiable.                     | High         | Med        | Sign snapshot with the institution private key; QR carries the signature (F-14).                                                                                                 |

> **Post-review revision (2026-06-08):** R-8…R-12 added after the critical
> self-review. See [architecture-review.md](architecture-review.md) for the full
> findings, severities, and dispositions. R-8 (F-0) is stack-affecting and needs
> a decision before Phase 2.

---

## 10. Compliance with Mandated Architecture

| Mandate                   | How satisfied                                                                |
| ------------------------- | ---------------------------------------------------------------------------- |
| Clean Architecture        | Four layers, inward-only dependencies (§3).                                  |
| DDD                       | Entities, value objects, domain services, ubiquitous language.               |
| SOLID                     | DI via ports; single-responsibility use-cases; ISP on repository interfaces. |
| Repository pattern        | Domain-owned `Repository<T>` ports; Prisma implementations in infra.         |
| Service layer             | Application use-cases + domain services.                                     |
| Dependency injection      | Constructor injection; composition root in infra.                            |
| UI never hits DB          | Presentation calls use-cases only; no Prisma import in UI.                   |
| Domain framework-free     | Domain runs under Vitest with no DB/UI.                                      |
| Calculations configurable | `GradeScale`, `AssessmentStructure`, standing bands.                         |
| Reporting template-driven | `TranscriptTemplate.layout` JSON drives rendering.                           |

---

## 11. Open Questions (for spec reconciliation)

1. Exact default grade bands and grade-point scale of the target institution(s). `[ASSUMPTION]` — a 5-point scale placeholder is used in examples.
2. The supplied transcript sample (Template V1) — layout, fields, branding. `[ASSUMPTION]` — modelled generically; see transcript-template doc.
3. Graduation eligibility rules (min CGPA, required credits, core-course passes). `[ASSUMPTION]`.
4. Whether v1 is genuinely multi-user on one machine or single-operator. `[ASSUMPTION]` — RBAC tables retained for forward-compatibility.
5. Calendar model breadth (SEMESTER/TRIMESTER/QUARTER) actually required at launch.

---

_Related: [erd.md](erd.md) · [database-design.md](database-design.md) ·
[folder-structure.md](folder-structure.md) ·
[security-architecture.md](security-architecture.md) ·
[reporting-architecture.md](reporting-architecture.md) ·
[transcript-template-architecture.md](transcript-template-architecture.md) ·
[implementation-plan.md](implementation-plan.md)_
