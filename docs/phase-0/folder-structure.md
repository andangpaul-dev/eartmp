# Folder Structure Specification

**Project:** EARTMP · **Phase:** 0 · **Status:** Draft, awaiting approval

This document defines the source layout, what belongs in each layer, the import
rules that enforce Clean Architecture, and where tests live. It refines the
structure declared in `CLAUDE.md` and demonstrated in `reference-implementation/`.

---

## 1. Top-level layout

```
EARTMP/
├─ CLAUDE.md                  # build governance (binding)
├─ README.md
├─ package.json
├─ tsconfig.json
├─ .env                       # DATABASE_URL
├─ prisma/
│  ├─ schema.prisma           # 23-table schema (source of truth)
│  ├─ migrations/             # generated migrations (Phase 1+)
│  └─ seed.ts                 # idempotent seed (roles, default scale, template)
├─ src/
│  ├─ domain/                 # innermost — pure, framework-free
│  ├─ application/            # use-cases orchestrating the domain
│  ├─ infrastructure/         # Prisma, SheetJS, PDFMake/DOCX, QR, backup, crypto
│  └─ presentation/           # React + Tauri UI
├─ src-tauri/                 # Tauri 2 Rust shell (Phase: shell bring-up)
│  ├─ src/                     # Rust commands / IPC façade
│  ├─ Cargo.toml
│  └─ tauri.conf.json
├─ tests/                     # cross-cutting + integration tests
├─ docs/                      # specs + phase-0 design docs
└─ reference-implementation/  # prototyped core — REFERENCE ONLY, not built into app
```

> `reference-implementation/` is **reference material for Phases 4/7/9** per
> CLAUDE.md. It is not imported by the app and not part of the build graph. Code
> is adapted from it deliberately when those phases arrive, never pasted
> wholesale.

---

## 2. Layer contents and rules

### 2.1 `src/domain/` — Domain layer

**Imports allowed:** other `domain/` modules only. **Forbidden:** React, Prisma,
Tauri, Node I/O, `application/`, `infrastructure/`, `presentation/`.

```
domain/
├─ value-objects/     # GradeScale, AssessmentStructure (validated config)
├─ services/          # GpaEngine, GraduationPolicy, ... (pure business rules)
├─ entities/          # Student, Course, ResultRecord, Transcript + invariant helpers
├─ repositories/      # PORT interfaces: StudentRepository, ResultRepository,
│                     #   TranscriptRepository, AuditLogPort, ...
└─ errors/            # typed domain errors (GradeScaleError, AssessmentError, ...)
```

What lives here: entities, value objects, domain services, repository
**interfaces**, domain errors, and domain-level types/unions
(`StudentStatus`, `CourseType`). No I/O, no `async` that hits a DB.

### 2.2 `src/application/` — Application layer

**Imports allowed:** `domain/` (entities, services, ports). **Forbidden:**
Prisma, React, Tauri, concrete infra classes.

```
application/
├─ use-cases/         # one class per operation:
│                     #   ProcessSemesterResults, ImportResults,
│                     #   GenerateTranscript, EvaluateGraduation,
│                     #   ManageStudents, ConfigureGradeScale, ...
├─ dto/               # input/output DTOs for use-cases
└─ ports/             # application-level ports not owned by domain
                      #   (e.g. SpreadsheetReaderPort, DocumentRendererPort,
                      #    BackupPort, ClockPort, HashingPort)
```

Use-cases take dependencies **by interface** via the constructor (DI). They never
`new` a Prisma client. They orchestrate domain services + ports and write audit
entries.

### 2.3 `src/infrastructure/` — Infrastructure layer

**Imports allowed:** everything inward (`domain/`, `application/` ports) + outer
libraries. This is the only layer that touches I/O.

```
infrastructure/
├─ db/
│  ├─ prisma.ts                # PrismaClient singleton / connection
│  └─ mappers/                 # Prisma row <-> domain entity mappers
├─ repositories/               # Prisma implementations of domain ports:
│                              #   PrismaStudentRepository, PrismaResultRepository, ...
├─ import/                     # SheetJS reader -> validation -> error report
├─ reporting/
│  ├─ pdf/                     # PDFMake renderer (template JSON -> docDefinition)
│  └─ docx/                    # docx generator
├─ crypto/                     # Argon2 hashing, backup encryption
├─ qr/                         # QR generation + verification payloads
├─ backup/                     # compressed SQLite copy, USB export, restore
└─ di/                         # composition root: wires ports -> concrete impls
```

The **composition root** (`infrastructure/di/`) is the only place that knows
both the interface and the concrete class. Everything else depends on
interfaces.

### 2.4 `src/presentation/` — Presentation layer

**Imports allowed:** `application/` use-case interfaces (via the DI/IPC façade),
UI libs. **Forbidden:** direct Prisma/DB access, importing
`infrastructure/repositories` directly.

```
presentation/
├─ app/                # routing, providers (TanStack Query, theme)
├─ features/           # feature-sliced UI: students/, courses/, results/,
│                      #   transcripts/, config/, backup/, audit/
│  └─ <feature>/
│     ├─ components/   # ShadCN-based components
│     ├─ hooks/        # TanStack Query hooks calling use-cases
│     ├─ schemas/      # Zod schemas for forms (mirror domain invariants)
│     └─ pages/        # screen-level components
├─ components/ui/      # shared ShadCN primitives
├─ lib/                # UI utilities (formatting, query client)
└─ ipc/               # thin façade calling Tauri commands / use-cases
```

The UI calls use-cases through `presentation/ipc` (or Tauri commands), never a
repository. TanStack Query caches use-case results; React Hook Form + Zod handle
form state and edge validation.

---

## 3. Dependency rule (the one invariant)

```
presentation ─▶ application ─▶ domain
        │            │            ▲
        └──────▶ infrastructure ──┘  (implements domain & application ports)
```

- Arrows = "may import". Inner layers never import outer ones.
- `infrastructure` may import `domain`/`application` to _implement_ their ports;
  it is wired in only at the composition root.
- **Enforcement:** an ESLint boundary rule (`eslint-plugin-boundaries` or
  `import/no-restricted-paths`) plus an architecture fitness test that fails CI
  if `domain/**` imports React/Prisma/Tauri. See
  [coding-standards.md](coding-standards.md) §"Architecture fitness".

---

## 4. Test layout

```
tests/                          # integration & cross-layer (uses real Prisma on a temp DB)
src/<layer>/**/__tests__/       # co-located unit tests (preferred for domain)
```

- **Domain/unit tests** sit next to the code (`*.test.ts`) and run with no DB/UI
  — the proof of domain purity.
- **Integration tests** (`tests/`) exercise Prisma repositories and use-cases
  end-to-end against a throwaway SQLite file.
- Mirrors the `reference-implementation/tests/` pattern (`engines.test.ts`,
  `use-case.test.ts` with in-memory fakes).

---

## 5. Naming & file conventions (summary)

| Kind                                  | Convention                        | Example                            |
| ------------------------------------- | --------------------------------- | ---------------------------------- |
| Value object / entity / service class | PascalCase file = class           | `GradeScale.ts`                    |
| Use-case                              | PascalCase verb-noun              | `ProcessSemesterResults.ts`        |
| Port interface                        | PascalCase, `…Repository`/`…Port` | `ResultRepository`, `AuditLogPort` |
| Prisma impl                           | `Prisma<Name>`                    | `PrismaResultRepository.ts`        |
| React component                       | PascalCase                        | `StudentForm.tsx`                  |
| Hook                                  | `use…`                            | `useProcessResults.ts`             |
| Zod schema                            | `…Schema`                         | `studentSchema.ts`                 |
| Test                                  | `*.test.ts(x)`                    | `GpaEngine.test.ts`                |

Full conventions: [coding-standards.md](coding-standards.md).

---

## 6. Where new code goes (decision guide)

- A new **business rule/calculation** → `domain/services` or a value object.
- A new **multi-entity operation** → `application/use-cases`.
- A new **DB query / external integration** → `infrastructure/`.
- A new **screen/form** → `presentation/features/<feature>`.
- A new **interface the domain needs the outside world to fulfil** →
  `domain/repositories` (data) or `application/ports` (services).

_Related: [solution-architecture.md](solution-architecture.md) ·
[coding-standards.md](coding-standards.md)_
