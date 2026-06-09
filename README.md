# EduCore (EARTMP) — Core Domain Foundation

This is a **foundation slice** of the Academic Records & Transcript Management
Platform described in the specification. It implements the parts the spec cares
about most — the configurable engines — as fully-typed, tested TypeScript that
sits at the centre of the Clean Architecture you asked for.

The full platform (Tauri shell, React UI, Prisma/SQLite, PDF/DOCX export, QR
verification, backup) is a multi-week build. Rather than stub all of it
shallowly, this delivers the **defensible core** correctly and gives you a clear
map for the rest.

## What's implemented and tested (16 passing tests, strict TS)

| Layer                | File                                                  | Spec requirement satisfied                                                                       |
| -------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Grading**          | `src/domain/value-objects/GradeScale.ts`              | "No hardcoded grading rules." Runtime-configured bands; validates gaps/overlaps/coverage.        |
| **Assessment**       | `src/domain/value-objects/AssessmentStructure.ts`     | "Assessment types must be dynamic." Weighted components summing to 100.                          |
| **GPA / standing**   | `src/domain/services/GpaEngine.ts`                    | Final score, grade point, credits earned, semester GPA, CGPA (aggregate), configurable standing. |
| **Entities**         | `src/domain/entities/index.ts`                        | Framework-free Student/Course/Result/Transcript types + invariant rules.                         |
| **Repository ports** | `src/domain/repositories/index.ts`                    | Dependency-inversion boundary; audit log is append-only by design.                               |
| **Use-case**         | `src/application/use-cases/ProcessSemesterResults.ts` | Orchestrates engines + repos; writes audit entry. Tested against in-memory fakes (no DB needed). |
| **Database**         | `prisma/schema.prisma`                                | All 23 SDP tables, SQLite, soft-delete + timestamps everywhere (audit log immutable).            |

The use-case test running on in-memory fakes is the proof that the Clean
Architecture boundary holds: domain logic depends only on interfaces, never on
Prisma or the UI.

## Run it

```bash
npm install
npm run typecheck   # strict, noUncheckedIndexedAccess
npm test            # vitest
```

## Architecture

```
src/
  domain/            # pure business logic — depends on nothing
    value-objects/   # GradeScale, AssessmentStructure
    services/        # GpaEngine
    entities/        # (next: Student, Course, Result, Transcript)
    repositories/    # (next: interface definitions)
  application/        # use-cases orchestrating the domain
  infrastructure/     # Prisma/SQLite repos, SheetJS import, PDF/DOCX
  presentation/       # React + Tauri (separate package in full build)
```

The domain layer imports nothing from outer layers — verifiable by the fact
that the engines run under plain `vitest` with no DB, UI, or framework present.

## Suggested build order for the rest

Done: Phase 4 engines, domain entities, repository ports, Prisma schema (23
tables), and one end-to-end use-case.

1. **Prisma-backed repositories** — implement the ports in
   `src/infrastructure/repositories/` against the schema. (Run
   `npx prisma generate && npx prisma migrate dev` in an environment with
   network access to Prisma's binary host.)
2. **Import engine** — SheetJS reader → validation (student/course/assessment
   exists, marks in range, no duplicates) → error report → `ImportResults`
   use-case.
3. **Transcript engine** — template-based renderer (JSON layout → PDFMake doc
   definition) so no layout is hardcoded; Transcript Template V1 from SDP §8.
4. **Auth & RBAC** — Argon2 hashing, configurable permissions.
5. **Tauri + React shell** — ShadCN UI, TanStack Query, React Hook Form + Zod.
6. **Cross-cutting** — audit interceptor on every write, backup/restore
   (compressed SQLite copy + USB export), QR verification.

## Design notes worth flagging

- **CGPA is computed over aggregate quality points and credits**, not as an
  average of semester GPAs — the latter is wrong when credit loads differ. See
  the test `computes cumulative GPA across semesters by aggregate, not mean`.
- **Grade scale validation is strict**: a scale with a gap or that doesn't span
  0-100 is rejected at construction, so a misconfigured institution can't
  silently produce ungradeable marks.

## Known gaps to address next

- The Prisma schema's `Student.facultyId` is a scalar without a relation back
  to `Faculty` (faculty is normally derived via department → faculty). Add an
  explicit relation only if you need direct student-by-faculty queries.
- Prisma client generation and migration require network access to Prisma's
  binary host, which was blocked in the build sandbox. Schema is validated
  structurally (23 models, balanced, soft-delete present); run
  `npx prisma migrate dev` locally to generate the client and `dev.db`.
- `AssessmentConfig`, `GradeScale`, and `TranscriptTemplate` store their
  variable parts as JSON strings (components / bands / layout) — this is the
  mechanism that keeps rules and layouts out of code, per the SDP.
