# Coding Standards

**Project:** EARTMP · **Phase:** 0 · **Status:** Draft, awaiting approval

These standards are binding for all application code from Phase 1 onward. They
codify the conventions already visible in `reference-implementation/` and the
architecture rules in [folder-structure.md](folder-structure.md).

---

## 1. Language & compiler

- **TypeScript, strict mode.** `tsconfig` enables `strict`,
  `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`,
  `noFallthroughCasesInSwitch`. `tsc --noEmit` must be **clean** every phase
  (a Definition-of-Done gate in CLAUDE.md).
- ESM modules (`"type": "module"`).
- No `any` in committed code. Use `unknown` + narrowing, generics, or precise
  types. `// @ts-expect-error` requires an inline justification comment.
- Prefer `readonly` and immutable data. Value objects are immutable; expose
  copies (`toBands()`, `toComponents()`) rather than internal arrays — as the
  reference engines already do.

---

## 2. Naming conventions

| Element                            | Convention                     | Example                                |
| ---------------------------------- | ------------------------------ | -------------------------------------- |
| Classes / types / interfaces       | PascalCase                     | `GradeScale`, `ResultRepository`       |
| Variables / functions / methods    | camelCase                      | `computeFinalScore`, `creditsEarned`   |
| Constants (module-level immutable) | UPPER_SNAKE or camelCase const | `MAX_SCORE`                            |
| Files (class-bearing)              | match the class                | `GpaEngine.ts`                         |
| Files (React components)           | PascalCase                     | `StudentForm.tsx`                      |
| Enums-as-unions                    | PascalCase type, UPPER values  | `type StudentStatus = "ACTIVE" \| ...` |
| Ports                              | suffix `Repository` / `Port`   | `AuditLogPort`                         |
| Use-cases                          | verb-noun                      | `ProcessSemesterResults`               |
| Booleans                           | `is`/`has`/`can` prefix        | `isLocked`, `canExport`                |

Ubiquitous language: use domain terms consistently — _matric number, credit
value, grade point, quality points, GPA, CGPA, standing, transcript template,
snapshot_. Do not invent synonyms.

---

## 3. File & module organisation

- One primary export per file (a class, a use-case, a component). Small helper
  types may co-reside.
- Index barrels (`index.ts`) only for stable public surfaces of a folder (as in
  `domain/entities/index.ts`, `domain/repositories/index.ts`).
- Import order: node/builtins → external libs → internal (`domain` →
  `application` → `infrastructure`/`presentation`) → relative. Enforced by
  `eslint-plugin-import`.

---

## 4. Architecture boundaries (enforced, not advisory)

1. **`domain/` imports nothing outward** — no React, Prisma, Tauri, Node I/O.
2. **UI never touches the DB** — `presentation/` may not import
   `infrastructure/repositories` or Prisma.
3. **Use-cases depend on interfaces** — `application/` may not import concrete
   infra classes or `@prisma/client`.

**Enforcement mechanisms:**

- ESLint `import/no-restricted-paths` (or `eslint-plugin-boundaries`) rules per
  layer.
- An **architecture fitness test** (`tests/architecture.test.ts`) that scans
  `src/domain/**` for forbidden imports and fails CI on violation.
- The existing proof: domain + use-case tests run under Vitest with **no DB and
  no React** (in-memory fakes). Keep it that way — if a domain test suddenly
  needs Prisma, the boundary has been broken.

---

## 5. Domain design rules

- **Validate at construction.** Value objects reject invalid configuration in a
  static `create()` and keep the constructor private (see `GradeScale.create`,
  `AssessmentStructure.create`). No half-valid object can exist.
- **Typed errors.** Throw domain-specific error classes (`GradeScaleError`,
  `AssessmentError`) — never bare strings — so callers can branch.
- **Pure functions where possible.** Engines (`GpaEngine`) are deterministic and
  side-effect-free; all I/O is pushed to the edges (use-cases + infra).
- **No hidden config.** Grading, assessment, standing bands, and transcript
  layout come in as parameters/data, never literals in the engine.
- **Numeric correctness.** Round only at boundaries (2dp via
  `Math.round(x*100)/100`), allow tiny float drift in invariant checks
  (`Math.abs(total-100) > 1e-6`), and compute CGPA over aggregate quality
  points/credits — never as a mean of GPAs.

---

## 6. Application/use-case rules

- One use-case = one class with an `execute(input): Promise<output>`.
- Dependencies injected via constructor as **interfaces**.
- Every state-changing use-case writes an **audit entry** via `AuditLogPort`.
- Wrap multi-write operations in a transaction (infra provides a
  `UnitOfWork`/transaction port; use-case stays persistence-agnostic).
- Validate inputs at the boundary (Zod DTO), then trust types internally.

---

## 7. Infrastructure rules

- Prisma access only here. A single `PrismaClient` instance (`db/prisma.ts`).
- **Mappers** translate Prisma rows ↔ domain entities; the domain type never
  leaks Prisma fields.
- Repositories filter `deletedAt IS NULL` by default; expose explicit
  `…IncludingDeleted` variants when needed.
- Parse-and-validate JSON config columns through the owning value object on read.

---

## 8. Presentation rules

- Components are typed; props interfaces explicit.
- Data fetching via TanStack Query hooks that call use-cases through the IPC
  façade; no business logic in components.
- Forms use React Hook Form + Zod; Zod schemas mirror — but do not replace —
  domain invariants (domain remains the source of truth).
- Accessibility: ShadCN primitives, semantic HTML, keyboard navigability.
- No direct `fetch`/DB calls from components.

---

## 9. Testing requirements

Per CLAUDE.md and the master prompt, **every phase ships with tests**.

- **Frameworks:** Vitest + React Testing Library.
- **Coverage target: ≥ 80%** (statements/branches), measured via
  `vitest --coverage`. CI fails below threshold.
- **Test pyramid:**
  - _Unit_ (most): domain value objects, engines, pure functions — no DB/UI.
  - _Integration:_ use-cases against in-memory fakes; Prisma repos against a
    temp SQLite DB.
  - _Validation/acceptance:_ each phase's completion criteria encoded as tests.
- **Determinism:** no reliance on wall-clock/randomness in assertions; inject a
  `ClockPort` where time matters (avoids `Date.now()` flakiness).
- **Naming:** `describe` by unit, `it` states behaviour
  ("computes cumulative GPA across semesters by aggregate, not mean").
- **Golden-master tests** for GPA/CGPA per institution profile and for rendered
  transcript snapshots.

---

## 10. Linting & formatting

- **Prettier** for formatting (single source of truth; no style debates in
  review). 2-space indent, double quotes (matches reference code), semicolons,
  trailing commas.
- **ESLint** with `@typescript-eslint`, `eslint-plugin-import`, boundary plugin,
  and React/hooks plugins for the UI.
- CI runs `prettier --check`, `eslint`, `tsc --noEmit`, `vitest run --coverage`.
  All four must pass.
- Pre-commit hook (lint-staged) runs Prettier + ESLint on staged files.

---

## 11. Comments & documentation

- Doc-comment every exported class/function with intent and non-obvious rules
  (see the reference files — they explain _why_ CGPA is aggregate-based, why
  scales are validated). Comments explain **why**, not what.
- Keep `/docs` updated continuously (a CLAUDE.md rule).
- Each phase updates the relevant doc(s) as part of Definition of Done.

---

## 12. Git & review

- Conventional-commit-style messages (`feat:`, `fix:`, `test:`, `docs:`,
  `refactor:`).
- No future-phase code (BSD §11). PRs are scoped to one phase's deliverables.
- Definition of Done per phase (from CLAUDE.md): deliverables exist; tests pass;
  `tsc --noEmit` clean; boundaries intact; `/docs` updated; summary posted and
  **approval requested.**

_Related: [folder-structure.md](folder-structure.md) ·
[solution-architecture.md](solution-architecture.md)_
