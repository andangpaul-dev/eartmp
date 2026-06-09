# Phase 5 — Schema Bundle + Academic Structure

**Project:** EARTMP · **Phase:** 5 · **Status:** Plan drafted, awaiting approval
to implement · **Predecessor:** Phase 4 (implemented)

> Deliverables-before-implementation spec, in the mandated format. Nothing is
> built/migrated until you approve. Phase 5 has two parts: **A** the reviewed
> schema-revision bundle (ADR-010), applied + verified first; **B** the academic-
> structure logic. Same proof model: headless, ≥80% coverage, dev Prisma adapters,
> runnable demo.

---

## Executive Summary

Phase 5 begins with the **pre-Phase-5 schema-revision bundle** the architecture
review deferred to "before Phase 5" (ADR-010): grade-scale provenance on results,
student enrollment history, optimistic-lock version columns, FK indexes, and
soft-delete-safe uniqueness. Two bundle items have meaningful cost/ripple and are
flagged as **decisions** (course-offering remodel; DB-level CHECK constraints) —
recommended **deferred**. Once the schema is in place and verified, Phase 5 builds
the **academic structure** domain + use-cases: faculty → department → programme →
level, and academic session → semester, all permission-gated and audited.

---

# Part A — Schema-Revision Bundle (ADR-010)

Applied as one reviewed migration **before** any Part B logic. Each item has a
disposition: **APPLY** (in this bundle), **DECISION** (needs your call),
**DEFER** (recommended, with rationale).

| Item                          | Finding | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Disposition                                                                              |
| ----------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Result provenance             | F-19    | Add `Result.gradeScaleId String?` + `Result.assessmentConfigId String?` (nullable; optional relations) so every processed grade records which config produced it.                                                                                                                                                                                                                                                                                                                                                                                  | **APPLY**                                                                                |
| Enrollment history            | F-22    | New `StudentEnrollment` table (`studentId, programmeId, levelId, fromSession, toSession?, isCurrent`) to historize transfers/progression. Table now; use-cases in Phase 6.                                                                                                                                                                                                                                                                                                                                                                         | **APPLY**                                                                                |
| Optimistic locking            | F-27    | Add `version Int @default(0)` to the edited/locked aggregates: `Result`, `Student`, `Transcript`.                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **APPLY**                                                                                |
| FK indexes                    | F-26    | `@@index` on FK scalars not already indexed: `Department.facultyId`, `Programme.departmentId`, `Level.programmeId`, `Semester.sessionId`, `User.roleId`, `Course.departmentId/levelId`.                                                                                                                                                                                                                                                                                                                                                            | **APPLY**                                                                                |
| Soft-delete-safe uniqueness   | F-20    | Replace unconditional `@unique` with **partial unique indexes** (`WHERE deletedAt IS NULL`) on **user-facing entity codes** only: `Faculty.code`, `Department.code`, `Programme.code`, `Course.code`, `Student.matricNumber`, `Student.regNumber`, `AcademicSession.name`. Keep plain `@unique` on **config/catalog** tables (`Role.name`, `Permission.key`, `User.username/email`, `GradeScale.name`, `AssessmentConfig.name`, `TranscriptTemplate.name`, `Setting.key`) where soft-delete-recreate isn't a workflow and seed upserts rely on it. | **DECISION** (recommended; confirm the split)                                            |
| Course offering vs definition | F-23    | A `CourseOffering` table (course × session) would re-point `Result` from `courseId`+`semesterId` to an offering — **high ripple** into Result and Phase 9.                                                                                                                                                                                                                                                                                                                                                                                         | **DEFER** (recommend) — revisit when the institution confirms cross-session course reuse |
| Enum CHECK constraints        | F-24    | SQLite can't `ALTER TABLE ADD CHECK`; adding CHECKs needs a full table-rebuild per table — high migration cost for low marginal value over the domain/Zod enforcement already in place.                                                                                                                                                                                                                                                                                                                                                            | **DEFER** (recommend) — enforce enums in the domain layer                                |

### Part A architecture decisions

- **AD5.1 — Provenance columns are nullable + optional relations.** Existing rows
  stay valid; Phase 9 populates them when processing. The loader (Phase 4) already
  resolves a scale by id, so wiring is a one-liner there.
- **AD5.2 — Partial unique indexes via raw SQL.** Prisma's `@unique` is
  unconditional, so the migration drops it on the listed user-facing codes and
  adds `CREATE UNIQUE INDEX ... WHERE deletedAt IS NULL`. Repositories for those
  entities use `findFirst` (not `findUnique`) and enforce uniqueness among live
  rows. Seed/catalog upserts are untouched (their `@unique` stays).
- **AD5.3 — `version` is checked-then-incremented** by write use-cases later
  (optimistic concurrency); Phase 5 only adds the column + default.

### Part A test/verification

- Migration applies cleanly to a throwaway DB; existing seed still runs idempotently.
- Partial-unique behaviour: re-creating a soft-deleted `Faculty.code` succeeds;
  a duplicate **live** code fails (integration test).
- All existing tests stay green (no regressions).

---

# Part B — Academic Structure

Built after Part A is verified.

## Objectives

1. Model and manage **Faculty → Department → Programme → Level** and
   **AcademicSession → Semester**, with their invariants.
2. CRUD + soft-delete use-cases, **permission-gated** (`structure.manage` /
   `structure.read`) and **audited**.
3. Calendar management: create sessions/semesters, enforce
   `Semester(sessionId, rank)` ordering, mark exactly one **current** session.

## Deliverables

| #   | Deliverable                                                                                                                                                                | Layer              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| B1  | Domain entities + invariants: `Faculty`, `Department`, `Programme`, `Level`, `AcademicSession`, `Semester`                                                                 | domain             |
| B2  | Repository ports for each (incl. hierarchy lookups, `findCurrentSession`)                                                                                                  | domain             |
| B3  | Use-cases: `ManageFaculty`, `ManageDepartment`, `ManageProgramme`, `ManageLevel`, `ManageCalendar` (create/update/list/soft-delete; set-current-session) — gated + audited | application        |
| B4  | Invariants: department belongs to faculty; programme to department; level to programme (rank-ordered); semester to session (rank unique); single current session           | domain/application |
| B5  | Dev-only Prisma repositories for the structure tables                                                                                                                      | infra (dev)        |
| B6  | Seed: `structure.read`/`structure.manage` permissions (+ a small sample hierarchy in dev)                                                                                  | seed               |
| B7  | `scripts/demo-structure.ts` — build/inspect a sample hierarchy + calendar                                                                                                  | scripts (dev)      |
| B8  | Tests (≥80% coverage on new domain+application code)                                                                                                                       | tests              |
| B9  | `/docs` update + implementation notes                                                                                                                                      | docs               |

## Part B architecture decisions

- **AD5.4 — Referential invariants enforced in use-cases**, not just FKs (e.g.
  creating a department validates the faculty exists and is live).
- **AD5.5 — "Current session" is a single-writer invariant**: setting a session
  current clears the flag on others (in one transaction once the UoW lands; for
  now, sequential with an audit entry).
- **AD5.6 — Soft-delete cascade is logical, not physical**: soft-deleting a
  faculty is blocked if it has live departments (fail-closed), surfaced as a
  domain error — no orphaned children.

## Validation Rules

- Codes unique among **live** rows (partial-unique from Part A); names non-empty.
- Level/semester `rank` positive; `Semester(sessionId, rank)` unique.
- Exactly one `AcademicSession.isCurrent === true`.
- Block soft-delete of a parent with live children (AD5.6).

## Test Plan (Part B)

| Test               | Asserts                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------- |
| hierarchy creation | department requires live faculty; programme requires department; level requires programme |
| calendar           | session→semester rank uniqueness; setting current clears others; ordering by rank         |
| soft-delete guard  | deleting a faculty with live departments is rejected                                      |
| uniqueness         | duplicate live code rejected; reuse after soft-delete allowed                             |
| authz/audit        | structure writes gated by `structure.manage`; audited                                     |
| coverage           | ≥80% on new code                                                                          |

---

## Risks

| ID   | Risk                                                 | Mitigation                                                                                   |
| ---- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| P5-a | Partial-unique migration breaks seed/catalog upserts | only user-facing codes lose `@unique`; catalog `@unique` kept (AD5.2); migration test guards |
| P5-b | Raw-SQL partial indexes drift from Prisma model      | migration test recreates DB + runs the suite                                                 |
| P5-c | Course-offering deferral wrong for the institution   | flagged as DECISION; cheap to add later as a new table + nullable Result FK                  |
| P5-d | Provenance columns unused until Phase 9              | nullable now; no behaviour depends on them yet                                               |
| P5-e | "Current session" race (multi-user later)            | single-writer v1; UoW transaction wraps it in Phase 7                                        |

---

## Completion Criteria

- [ ] Part A migration applied; seed idempotent; partial-unique + provenance +
      version + FK indexes verified; existing tests green.
- [ ] Part B: structure + calendar use-cases built, gated, audited; invariants enforced.
- [ ] `demo:structure` builds and inspects a sample hierarchy/calendar.
- [ ] Tests pass; coverage ≥80% on new code; `tsc` strict clean; lint/format clean.
- [ ] Boundaries intact (fitness test green).
- [ ] `/docs` updated; summary posted; **approval requested before Phase 6.**

---

## Approval Checklist (to start Phase 5 implementation)

- [ ] **Part A APPLY items** (provenance, enrollment table, version columns, FK indexes) approved.
- [ ] **Partial-unique split** (AD5.2: user-facing codes lose `@unique`, catalog keeps it) approved.
- [ ] **Course-offering**: confirm **DEFER** (recommended) or ask me to model it now.
- [ ] **CHECK constraints**: confirm **DEFER** (domain-enforced) or require DB-level now.
- [ ] **Version columns** on `Result`/`Student`/`Transcript` acceptable (or name the set).
- [ ] Part B scope (structure + calendar, logic only) confirmed.
- [ ] Go-ahead to implement (Part A migration first, then Part B).

_Related: [architecture-review.md](../phase-0/architecture-review.md) (ADR-010, F-19/F-20/F-22/F-23/F-24/F-26/F-27) ·
[database-design.md](../phase-0/database-design.md) · [erd.md](../phase-0/erd.md)_
