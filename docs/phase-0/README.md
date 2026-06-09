# Phase 0 — Solution Design Deliverables

This folder contains the **Phase 0** documentation set for the EduCore Academic
Records & Transcript Management Platform (EARTMP), per the Build Sequence
Document (BSD) and the master kickoff prompt. **No application code is approved
or written in Phase 0** — these documents are the deliverable.

## Provenance note (read first)

CLAUDE.md names three _authoritative_ specs — `software-specification.md`,
`software-design-package.md`, `build-sequence-document.md` — that were **not
present in the repository** when this set was authored. Per an explicit decision
recorded with the user, these Phase 0 documents were **reconstructed from the
available artifacts**:

- `prisma/schema.prisma` (the complete 23-table schema),
- `reference-implementation/` (configurable `GradeScale`, `AssessmentStructure`,
  `GpaEngine`, entities, repository ports, and the `ProcessSemesterResults`
  use-case with passing tests),
- `CLAUDE.md`, `README.md`, and `PHASE-0-KICKOFF.md`.

Where a fact could not be sourced from an artifact (e.g. the exact grade bands of
the target institution, the precise transcript sample layout, functional-
requirement IDs), it is marked **`[ASSUMPTION]`** and should be confirmed against
the real SDP/SST when those are supplied. Until then, **these documents are
treated as the de-facto specification.**

## Documents

| #   | Document                                       | File                                                                       |
| --- | ---------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | Solution Architecture Document (SAD)           | [solution-architecture.md](solution-architecture.md)                       |
| 2   | Entity Relationship Diagram (ERD)              | [erd.md](erd.md)                                                           |
| 3   | Database Design Specification                  | [database-design.md](database-design.md)                                   |
| 4   | Folder Structure Specification                 | [folder-structure.md](folder-structure.md)                                 |
| 5   | Coding Standards                               | [coding-standards.md](coding-standards.md)                                 |
| 6   | Security Architecture                          | [security-architecture.md](security-architecture.md)                       |
| 7   | Reporting Architecture                         | [reporting-architecture.md](reporting-architecture.md)                     |
| 8   | Transcript Template Architecture               | [transcript-template-architecture.md](transcript-template-architecture.md) |
| 9   | Development Environment Setup Guide            | [environment-setup.md](environment-setup.md)                               |
| 10  | Detailed Implementation Plan                   | [implementation-plan.md](implementation-plan.md)                           |
| ★   | **Architecture Review (critical self-review)** | [architecture-review.md](architecture-review.md)                           |

## Status

Phase 0 is **APPROVED** (2026-06-08). Phase 1 (foundation) is **implemented and
verified**. A **critical architecture review** was then performed
([architecture-review.md](architecture-review.md)) which raised one 🔴 stack-level
finding (F-0: Prisma/Node cannot run inside Tauri/Rust) plus transaction,
encryption, authorization, and verification gaps. Affected docs carry **post-
review revision banners**. Four decisions are pending before Phase 2 — see the
review §8. Per BSD §11, no further phase begins without approval.
