# Phase 6 — Students & Courses

**Project:** EARTMP · **Phase:** 6 · **Status:** Plan drafted, awaiting approval
to implement · **Predecessor:** Phase 5 (implemented + committed)

> Deliverables-before-implementation spec, in the mandated format. Nothing is
> built until you approve. Same proof model: headless domain/application logic,
> ≥80% coverage, dev Prisma adapters, runnable demo; UI + Tauri-SQL persistence
> deferred to their phases.

---

## Executive Summary

Phase 6 builds **student records** and the **course registry** — the entities
everything downstream (results, transcripts, graduation) operates on. It adds a
**student status workflow** (a validated state machine over ACTIVE / SUSPENDED /
DEFERRED / WITHDRAWN / GRADUATED), wires the **`StudentEnrollment`** history table
provisioned in Phase 5 (enroll / transfer / progress), and introduces
**paginated, filtered listing** in the repository ports — closing review finding
**F-7** before the 10k-student scale matters. All permission-gated and audited.

---

## Scope & sequencing

| Concern                                            | Phase 6            | Deferred to            |
| -------------------------------------------------- | ------------------ | ---------------------- |
| Student CRUD + soft-delete                         | ✅                 | —                      |
| Student **status workflow** (state machine)        | ✅                 | —                      |
| **Enrollment history** use-cases (enroll/transfer) | ✅                 | —                      |
| Course registry CRUD + soft-delete                 | ✅                 | —                      |
| **Paginated/filtered** list ports (F-7)            | ✅                 | —                      |
| Optimistic-lock enforcement via `version`          | ⛔ (column exists) | Phase 7 (UoW, ADR-011) |
| Concrete Tauri-SQL persistence                     | ⛔                 | Phase 7                |
| UI screens                                         | ⛔                 | Shell phase            |

---

## Objectives

1. Manage **students**: create, update, get, soft-delete; matric/reg numbers
   unique among live rows (partial-unique from Phase 5).
2. A **status workflow**: `ChangeStudentStatus` validates the transition against
   an allowed-transition matrix; terminal states (GRADUATED/WITHDRAWN) are
   immutable (`StudentRules.isFinalized`).
3. **Enrollment history**: `EnrollStudent` (open a current enrollment),
   `TransferStudent` / `ProgressLevel` (close the current, open a new),
   `GetEnrollmentHistory` — single-current-enrollment invariant.
4. Manage **courses**: create, update, list (by programme/department/level),
   soft-delete; code unique among live rows; credit value > 0.
5. **Pagination/filtering** in the student/course list ports (`{ where, skip,
take }` → page + total) — closes F-7.

**Out of scope:** results entry/processing (Phase 9), optimistic-lock enforcement
(Phase 7), UI, Tauri-SQL persistence.

---

## Deliverables

| #   | Deliverable                                                                                                                                         | Layer         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| D1  | Adopt/reconcile existing `Student`/`Course`/`StudentRules` (domain `entities/index.ts`); add `StudentEnrollment` entity + status-transition matrix  | domain        |
| D2  | Ports: `StudentRepository`, `CourseRepository`, `StudentEnrollmentRepository` with **paginated `find(query)`** + `findByMatric`/`findByCode` (live) | domain        |
| D3  | Student use-cases: `CreateStudent`, `UpdateStudent`, `GetStudent`, `ListStudents` (paged/filtered), `ChangeStudentStatus`, `DeleteStudent`          | application   |
| D4  | Enrollment use-cases: `EnrollStudent`, `TransferStudent`, `GetEnrollmentHistory`                                                                    | application   |
| D5  | Course use-cases: `CreateCourse`, `UpdateCourse`, `ListCourses` (paged/filtered), `DeleteCourse`                                                    | application   |
| D6  | Dev-only Prisma repositories for Student, Course, StudentEnrollment                                                                                 | infra (dev)   |
| D7  | Seed: `courses.read`/`courses.create`/`courses.update` permissions (students.\* already seeded)                                                     | seed          |
| D8  | `scripts/demo-records.ts` — create students/courses, change status, enroll/transfer, paged list                                                     | scripts (dev) |
| D9  | Tests (≥80% coverage on new domain+application code)                                                                                                | tests         |
| D10 | `/docs` update + implementation notes                                                                                                               | docs          |

---

## Architecture Decisions

- **AD6.1 — Status workflow is a validated state machine.** `ChangeStudentStatus`
  consults an allowed-transition matrix; an illegal transition (e.g. GRADUATED →
  ACTIVE) throws a typed error. Proposed matrix (`[ASSUMPTION]`, confirm):

  | From      | Allowed to                                |
  | --------- | ----------------------------------------- |
  | ACTIVE    | SUSPENDED, DEFERRED, WITHDRAWN, GRADUATED |
  | SUSPENDED | ACTIVE, WITHDRAWN                         |
  | DEFERRED  | ACTIVE, WITHDRAWN                         |
  | WITHDRAWN | _(terminal)_                              |
  | GRADUATED | _(terminal)_                              |

- **AD6.2 — Single current enrollment.** Opening a new enrollment
  (enroll/transfer/progress) closes the prior current one (`toSession` set,
  `isCurrent=false`) in the use-case; exactly one `isCurrent` per student.
- **AD6.3 — Paginated ports (closes F-7).** List ports take
  `{ where?, skip?, take?, orderBy? }` and return `{ items, total }`. No
  unbounded `findAll` on Student/Course. Default `take` capped (e.g. 50).
- **AD6.4 — Uniqueness among live rows** (Phase 5 partial-unique): repositories
  use `findFirst` for matric/reg/code; create checks live duplicates first.
- **AD6.5 — Status/enrollment changes are audited** (old → new) via the seam.

---

## Database Changes

- **None to the schema shape** — `Student`, `Course`, `StudentEnrollment` exist
  (Phase 1 + Phase 5).
- **Seed additions:** `courses.read`/`courses.create`/`courses.update`
  permissions (granted to SUPER_ADMIN; read to REGISTRAR/DATA_ENTRY as fits).
- No `version` enforcement here (column exists; optimistic-lock check lands with
  the UoW in Phase 7).

---

## UI Screens

**None in Phase 6.** Future consumers (deferred): student list/detail/form,
status control, enrollment timeline, course registry. Use-case I/O designed
UI-ready (paged lists, typed inputs).

---

## Services / Use-cases (contracts, abridged)

- `CreateStudent.execute({ matricNumber, regNumber?, fullName, ...placement }, session)` → `students.create`; live-matric uniqueness; audits.
- `ChangeStudentStatus.execute({ studentId, to }, session)` → `students.update`; validates transition; audits old→new.
- `EnrollStudent.execute({ studentId, programmeId, levelId, fromSession }, session)` → `students.update`; closes prior current.
- `ListStudents.execute({ where?, skip?, take? }, session)` → `students.read`; `{ items, total }`.
- `CreateCourse.execute({ code, title, creditValue, courseType, ...placement }, session)` → `courses.create`; creditValue > 0; live-code uniqueness.
- `ListCourses.execute({ where?, skip?, take? }, session)` → `courses.read`.

---

## Validation Rules

- Matric/reg/course codes unique among **live** rows; names non-empty;
  `creditValue` a positive integer; `courseType ∈ {CORE,ELECTIVE,PRACTICAL,CLINICAL}`.
- Status transitions restricted to the matrix (AD6.1); terminal states immutable.
- Single current enrollment per student (AD6.2).
- All writes authorized (fail-closed) and audited; lists permission-gated + paged.

---

## Test Plan

| Test                     | Asserts                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| CreateStudent            | live-matric uniqueness; reuse after soft-delete; audit; authz                            |
| ChangeStudentStatus      | legal transition applies + audits; illegal/terminal transition rejected                  |
| Enrollment               | enroll opens current; transfer closes prior + opens new; single current; history ordered |
| CreateCourse             | code uniqueness; creditValue > 0; courseType enum                                        |
| ListStudents/ListCourses | filter + pagination returns `{ items, total }`; default cap applied                      |
| authz/audit              | writes gated by the right permission; reads by `*.read`                                  |
| coverage                 | ≥80% on new code                                                                         |

All headless against in-memory fakes.

---

## Risks

| ID   | Risk                                              | Mitigation                                                                                      |
| ---- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| P6-a | Status matrix differs per institution             | matrix is explicit + `[ASSUMPTION]`; confirm; could become config later                         |
| P6-b | Pagination contract churn                         | settle `{ items, total }` now (AD6.3) so later phases build on it                               |
| P6-c | Enrollment vs `Student.programmeId/levelId` drift | the current enrollment is the source of truth; `Student.*` mirrors it, set in the same use-case |
| P6-d | Optimistic-lock not enforced yet                  | `version` exists; enforced with UoW in Phase 7 — documented, not silent                         |

---

## Completion Criteria

- [ ] Student + course CRUD, status workflow, and enrollment use-cases built,
      gated, audited; invariants enforced.
- [ ] Paginated/filtered list ports implemented (F-7 closed).
- [ ] `demo:records` runs the lifecycle end-to-end.
- [ ] Tests pass; coverage ≥80% on new code; `tsc` strict clean; lint/format clean.
- [ ] Boundaries intact (fitness test green).
- [ ] `/docs` updated; summary posted; **approval requested before Phase 7.**

---

## Approval Checklist (to start Phase 6 implementation)

- [ ] Scope confirmed: students + status workflow + enrollment + courses, logic only.
- [ ] **Status-transition matrix** (AD6.1) accepted, or provide the institution's rules.
- [ ] **Pagination contract** `{ items, total }` with a default `take` cap — OK.
- [ ] New `courses.*` permissions — OK.
- [ ] Go-ahead to implement.

_Related: [architecture-review.md](../phase-0/architecture-review.md) (F-7, F-22) ·
[phase-5 implementation notes](../phase-5/implementation-notes.md) ·
`src/domain/entities/index.ts` (existing Student/Course/StudentRules)_
