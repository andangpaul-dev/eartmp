# Phase 5 — Implementation Notes & Verification

**Status:** Implemented (Part A schema bundle + Part B academic structure). All
gates green. **Awaiting approval to start Phase 6.**

Approved decisions: all Part A APPLY items; partial-unique split; **defer**
course-offering and DB-level CHECK constraints.

---

## Verification evidence (commands run)

| Gate                | Command                  | Result                                                                                                                       |
| ------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Migration           | `prisma migrate dev`     | applied `phase5_schema_bundle`; client regenerated                                                                           |
| Partial-unique      | manual check             | reuse-after-soft-delete OK; live duplicate → P2002                                                                           |
| Seed                | `npm run db:seed`        | idempotent; structure perms added                                                                                            |
| Type-check          | `npm run typecheck`      | **clean**                                                                                                                    |
| Lint (+ boundaries) | `npm run lint`           | **0 errors**                                                                                                                 |
| Format              | `npm run format:check`   | **conforms**                                                                                                                 |
| Tests               | `npm run test:coverage`  | **123 passed**; stmts **94.8%** · branch **93.0%** · funcs **88.4%**                                                         |
| End-to-end demo     | `npm run demo:structure` | ✓ build hierarchy · ✓ duplicate-code rejected · ✓ soft-delete guard · ✓ unique semester rank · ✓ current-session · ✓ cleanup |

---

## Part A — schema bundle (ADR-010)

One reviewed migration (`prisma/migrations/20260609071837_phase5_schema_bundle/`):

- **Provenance (F-19):** `Result.gradeScaleId` + `Result.assessmentConfigId`
  (nullable, loose ids — survive config deletion).
- **Enrollment history (F-22):** new `StudentEnrollment` table (use-cases land in
  Phase 6).
- **Optimistic locking (F-27):** `version Int @default(0)` on `Result`,
  `Student`, `Transcript`.
- **FK indexes (F-26):** `Department.facultyId`, `Programme.departmentId`,
  `Level.programmeId`, `User.roleId`, `Course.departmentId/levelId`,
  `StudentEnrollment.*`.
- **Soft-delete-safe uniqueness (F-20):** dropped column `@unique` on user-facing
  codes (`Faculty/Department/Programme/Course.code`, `Student.matricNumber/
regNumber`, `AcademicSession.name`) and added **partial unique indexes**
  (`WHERE deletedAt IS NULL`) via hand-authored raw SQL appended to the
  migration. Catalog/config `@unique` (Role/Permission/User/GradeScale/
  AssessmentConfig/TranscriptTemplate/Setting) kept, so seed upserts are
  unaffected.
- **Deferred (recommended, accepted):** course-offering remodel (F-23, high
  ripple) and DB-level CHECK constraints (F-24, SQLite table-rebuild cost) —
  enums stay domain-enforced.

Repositories for the user-facing-code entities use `findFirst` (not `findUnique`)
and enforce uniqueness among live rows.

---

## Part B — academic structure

- **Domain** (`src/domain/entities/structure.ts`, `errors/structure.ts`,
  `repositories/structure.ts`): `Faculty`, `Department`, `Programme`, `Level`,
  `AcademicSession`, `Semester` + `StructureRules` + ports.
- **Application** (`use-cases/structure/`): `ManageStructure` (Create/Delete/List
  for faculty/department/programme + Create/List level) and `ManageCalendar`
  (CreateSession/SetCurrentSession/ListSessions/CreateSemester/ListSemesters).
  All permission-gated (`structure.manage`/`structure.read`) and audited.
- **Invariants enforced in use-cases**: parent exists & live before creating a
  child (AD5.4); soft-delete of a parent with live children is blocked (AD5.6);
  code unique among live rows; level/semester rank positive + unique within
  parent; single current session (set-current clears others, AD5.5).
- **Infra**: dev-only `PrismaStructureRepositories` (ADR-007).
- **Seed**: `structure.read`/`structure.manage` permissions (+ to REGISTRAR).
- `scripts/demo-structure.ts` (`npm run demo:structure`) — builds + verifies +
  cleans up a sample hierarchy/calendar (re-runnable).

**Tests** (`tests/structure/`): hierarchy referential invariants, code
uniqueness + reuse-after-soft-delete, rank uniqueness, soft-delete guard, single
current session, semester rank — headless against in-memory fakes.

> Minor deviation from the plan: the sample hierarchy is built (and cleaned up)
> by the demo rather than seeded, keeping the seed simple and the demo
> re-runnable. `Update*` use-cases were not added (Create/Delete/List cover the
> phase's needs); the repository `update` ports exist for later use.

---

## Definition of Done (CLAUDE.md)

- [x] Part A migration applied + verified; seed idempotent; existing tests green.
- [x] Part B structure + calendar use-cases built, gated, audited; invariants enforced.
- [x] `demo:structure` builds and inspects a sample hierarchy/calendar.
- [x] Tests pass (123); coverage ≥80% (94.8%); `tsc` strict clean; lint/format clean.
- [x] Boundaries intact (fitness test green).
- [x] `/docs` updated; summary posted; approval requested before Phase 6.

_Next: Phase 6 — Students & Courses (records + registry, status workflow, and the
`StudentEnrollment` use-cases provisioned in Part A)._
