# Student Identity — Admission Session & Matricule (Workstream C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure the admission session per student (immutable intake identity), build matricules from a configurable template with manual override, and support per-row multi-faculty import, graduate re-admission, matricule regeneration, operator-confirmed student merge, and bulk regeneration.

**Architecture:** A pure `expandMatricule` (extends the existing `TranscriptNumber.expandNumberRule` pattern) + pure check-digit functions; an application `GenerateMatricule` service that reserves from a new atomic `MatriculeCounter` table inside the caller's `UnitOfWork`; admission/import/readmit/merge/bulk use-cases built on the existing `Student`/`StudentEnrollment` model; settings via the existing `SettingsRegistry`; UI via the core. Reuses Workstream A faculty scoping (`requireInScope`/`requireInFacultyScope`/`scopeStudentWhere`).

**Tech Stack:** TypeScript (strict), Prisma + SQLite/libSQL, Vitest, React 19 + Tauri, Zod.

**Spec:** `docs/superpowers/specs/2026-06-20-student-identity-matricule-design.md`

**Conventions:**

- Run one test file: `npx vitest run tests/<path> -t "<name>"`. Full: `npx vitest run`. Typecheck: `npx tsc --noEmit`. Lint: `npx eslint src tests --quiet`.
- A lint-staged hook auto-runs prettier/eslint on commit. End commit message bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Concrete models to mirror: **migration** → `prisma/migrations/20260620120000_result_sitting_status/migration.sql` (WS B); **runtime migration runner** auto-discovers folders (`src/infrastructure/db/migrationRunner.ts`, no manifest); **wiring** → the `saveCourseResults`/`listCourseRoster` additions across `contract.ts`/`inputSchemas.ts`/`composition.ts`/`ipcClient.ts`/`tests/ui/harness.tsx` (WS B). **Faculty scope** helpers in `src/application/authorization/institutionScope.ts`.

---

## Phase 0 — Schema, migration & settings

### Task 0.1: Add `MatriculeCounter` model + `Student.previousStudentId`

**Files:**

- Modify: `prisma/schema.prisma` (Student model ~lines 260-295; add a new model)

- [ ] **Step 1: Add `previousStudentId` to `Student`.** Inside the `Student` model, after `admissionSession String?`, add:

```prisma
  previousStudentId String? // graduate re-admission link (loose id, no FK) — WS C
```

- [ ] **Step 2: Add the counter model** (anywhere after `Student`):

```prisma
// Per-(institution, faculty, admission-year) matricule sequence (WS C).
model MatriculeCounter {
  id            String   @id @default(cuid())
  institutionId String?
  facultyId     String
  year          Int
  next          Int      @default(1)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([institutionId, facultyId, year])
}
```

- [ ] **Step 3: Regenerate the client.**

Run: `npm run db:generate`
Expected: "Generated Prisma Client" with no error.

- [ ] **Step 4: Commit.**

```bash
git add prisma/schema.prisma
git commit -m "feat(students): MatriculeCounter model + Student.previousStudentId"
```

### Task 0.2: Migration

**Files:**

- Create: `prisma/migrations/20260620130000_matricule_identity/migration.sql`

- [ ] **Step 1: Write the SQL.**

```sql
-- Workstream C: matricule counter + graduate re-admission link.
ALTER TABLE "Student" ADD COLUMN "previousStudentId" TEXT;

CREATE TABLE "MatriculeCounter" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "institutionId" TEXT,
  "facultyId"     TEXT NOT NULL,
  "year"          INTEGER NOT NULL,
  "next"          INTEGER NOT NULL DEFAULT 1,
  "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     DATETIME NOT NULL
);
CREATE UNIQUE INDEX "MatriculeCounter_institutionId_facultyId_year_key"
  ON "MatriculeCounter"("institutionId", "facultyId", "year");
```

- [ ] **Step 2: Apply to the dev DB.**

Run: `npx prisma migrate deploy`
Expected: the new migration applied, no error.

- [ ] **Step 3: Commit.**

```bash
git add prisma/migrations/20260620130000_matricule_identity/migration.sql
git commit -m "feat(students): migration for MatriculeCounter + previousStudentId"
```

### Task 0.3: Migration upgrade-path test

**Files:**

- Modify: `tests/infrastructure/migration-upgrade.test.ts` (the WS A/B upgrade test — mirror its style)

- [ ] **Step 1: Add a test** asserting that after running migrations on a pre-C DB, `Student` has `previousStudentId` and the `MatriculeCounter` table + unique index exist (use `PRAGMA table_info`/`PRAGMA index_list`, never `SELECT "col"`):

```ts
it("adds MatriculeCounter + Student.previousStudentId", async () => {
  // ... reuse the file's pre-migration DB setup, run the runner ...
  const cols = await db.all(`PRAGMA table_info("Student")`);
  expect(cols.map((c: { name: string }) => c.name)).toContain(
    "previousStudentId",
  );
  const tbls = await db.all(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='MatriculeCounter'`,
  );
  expect(tbls.length).toBe(1);
  const idx = await db.all(`PRAGMA index_list("MatriculeCounter")`);
  expect(
    idx.some(
      (i: { name: string }) =>
        i.name === "MatriculeCounter_institutionId_facultyId_year_key",
    ),
  ).toBe(true);
});
```

- [ ] **Step 2: Run it.** `npx vitest run tests/infrastructure/migration-upgrade.test.ts` → PASS.
- [ ] **Step 3: Commit.**

```bash
git add tests/infrastructure/migration-upgrade.test.ts
git commit -m "test(migrations): assert MatriculeCounter + previousStudentId"
```

### Task 0.4: Settings — matricule rule, format & check scheme

**Files:**

- Modify: `src/domain/settings/SettingsRegistry.ts` (`SETTING_KEYS` + `buildDefaultRegistry`)
- Test: `tests/settings/matricule-settings.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from "vitest";
import {
  buildDefaultRegistry,
  SETTING_KEYS,
} from "../../src/domain/settings/SettingsRegistry";

describe("matricule settings", () => {
  const r = buildDefaultRegistry();
  it("registers rule/format/checkScheme with defaults", () => {
    expect(r.has(SETTING_KEYS.matriculeRule)).toBe(true);
    expect(r.has(SETTING_KEYS.matriculeFormat)).toBe(true);
    expect(r.has(SETTING_KEYS.matriculeCheckScheme)).toBe(true);
    expect(r.defaultValue(SETTING_KEYS.matriculeCheckScheme)).toBe("none");
  });
  it("rejects an unknown token in the rule", () => {
    expect(() =>
      r.validate(SETTING_KEYS.matriculeRule, "{bogus}-{seq}"),
    ).toThrow();
  });
  it("accepts a valid rule and a known scheme", () => {
    expect(
      r.validate(
        SETTING_KEYS.matriculeRule,
        "{faculty}{year2}-{seq:0000}{check}",
      ),
    ).toBeTruthy();
    expect(r.validate(SETTING_KEYS.matriculeCheckScheme, "luhn")).toBe("luhn");
    expect(() =>
      r.validate(SETTING_KEYS.matriculeCheckScheme, "crc"),
    ).toThrow();
  });
});
```

> Note: `SettingsRegistry` exposes `validate(key, value)` (read it to confirm the method name; `defaultValue(key)` exists per the file). If `validate` isn't public, add a tiny `validate(key, v)` that calls the def's validator.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** Add to `SETTING_KEYS`:

```ts
  matriculeRule: "student.matriculeRule",
  matriculeFormat: "student.matriculeFormat",
  matriculeCheckScheme: "student.matriculeCheckScheme",
```

Register in `buildDefaultRegistry` (a token validator that allows only the known tokens):

```ts
const MATRICULE_TOKENS =
  /\{(institutionCode|faculty|dept|year|year2|seq(:0+)?|check)\}/g;
r.register<string>({
  key: SETTING_KEYS.matriculeRule,
  schemaVersion: 1,
  description: "Template for building student matricules.",
  default: "{faculty}{year2}-{seq:0000}",
  validate: (v) => {
    const s = asString(v, SETTING_KEYS.matriculeRule);
    const leftover = s.replace(MATRICULE_TOKENS, "");
    const unknown = leftover.match(/\{[^}]*\}/);
    if (unknown)
      throw new SettingsError(`Unknown matricule token "${unknown[0]}".`);
    return s;
  },
});
r.register<string>({
  key: SETTING_KEYS.matriculeFormat,
  schemaVersion: 1,
  description:
    "Optional regex a MANUAL matricule must match (empty = no constraint).",
  default: "",
  validate: (v) => {
    const s = asString(v, SETTING_KEYS.matriculeFormat);
    if (s) {
      try {
        new RegExp(s);
      } catch {
        throw new SettingsError("matriculeFormat is not a valid regex.");
      }
    }
    return s;
  },
});
r.register<string>({
  key: SETTING_KEYS.matriculeCheckScheme,
  schemaVersion: 1,
  description: "Matricule check-digit scheme: none | luhn | mod97.",
  default: "none",
  validate: (v) => {
    const s = asString(v, SETTING_KEYS.matriculeCheckScheme);
    if (!["none", "luhn", "mod97"].includes(s)) {
      throw new SettingsError(`matriculeCheckScheme must be none|luhn|mod97.`);
    }
    return s;
  },
});
```

- [ ] **Step 4: Run → PASS;** `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit.**

```bash
git add src/domain/settings/SettingsRegistry.ts tests/settings/matricule-settings.test.ts
git commit -m "feat(settings): matricule rule/format/checkScheme"
```

---

## Phase 1 — Pure domain: expansion & check digits

### Task 1.1: Check-digit functions (Luhn + ISO 7064 mod-97)

**Files:**

- Create: `src/domain/services/MatriculeCheck.ts`
- Test: `tests/domain/matricule-check.test.ts`

- [ ] **Step 1: Write the failing test** (known vectors):

```ts
import { describe, it, expect } from "vitest";
import {
  luhnDigit,
  mod97Digits,
  computeCheck,
} from "../../src/domain/services/MatriculeCheck";

describe("matricule check digits", () => {
  it("luhn over decimal digits is deterministic", () => {
    // "7992739871" Luhn check digit is 3 (classic vector)
    expect(luhnDigit("7992739871")).toBe("3");
    expect(luhnDigit("FS25-0042")).toBe(luhnDigit("250042")); // letters ignored
  });
  it("mod97 returns two digits 00..96 and is stable", () => {
    const d = mod97Digits("FS250042");
    expect(d).toMatch(/^\d\d$/);
    expect(mod97Digits("FS250042")).toBe(d);
  });
  it("computeCheck dispatches on scheme", () => {
    expect(computeCheck("none", "FS250042")).toBe("");
    expect(computeCheck("luhn", "FS250042")).toBe(luhnDigit("FS250042"));
    expect(computeCheck("mod97", "FS250042")).toBe(mod97Digits("FS250042"));
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** (pure; no imports beyond types):

```ts
/**
 * Matricule check-digit schemes (WS C). Pure functions.
 * - luhn: standard mod-10 over the DECIMAL digits of the body (letters ignored).
 * - mod97: ISO 7064 MOD 97-10 over the ALPHANUMERIC body (A-Z → 10..35), 2 digits.
 */
export type CheckScheme = "none" | "luhn" | "mod97";

export function luhnDigit(body: string): string {
  const digits = body.replace(/\D/g, "");
  let sum = 0;
  let dbl = true; // doubling starts from the rightmost digit of the appended check
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return String((10 - (sum % 10)) % 10);
}

export function mod97Digits(body: string): string {
  // Map A-Z → 10..35, keep digits, drop other chars; then number mod 97.
  let numeric = "";
  for (const ch of body.toUpperCase()) {
    if (ch >= "0" && ch <= "9") numeric += ch;
    else if (ch >= "A" && ch <= "Z") numeric += String(ch.charCodeAt(0) - 55);
  }
  // big-number mod 97 without BigInt overflow
  let rem = 0;
  for (const ch of numeric) rem = (rem * 10 + (ch.charCodeAt(0) - 48)) % 97;
  const check = (98 - ((rem * 100) % 97)) % 97; // ISO 7064 MOD 97-10
  return String(check).padStart(2, "0");
}

export function computeCheck(scheme: CheckScheme, body: string): string {
  if (scheme === "luhn") return luhnDigit(body);
  if (scheme === "mod97") return mod97Digits(body);
  return "";
}
```

- [ ] **Step 4: Run → PASS.** Commit.

```bash
git add src/domain/services/MatriculeCheck.ts tests/domain/matricule-check.test.ts
git commit -m "feat(domain): matricule check-digit schemes (luhn, mod97)"
```

### Task 1.2: `expandMatricule` + admission-year parsing

**Files:**

- Create: `src/domain/services/Matricule.ts`
- Test: `tests/domain/matricule-expand.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from "vitest";
import {
  expandMatricule,
  admissionYear,
  type MatriculeTokens,
} from "../../src/domain/services/Matricule";

const base: MatriculeTokens = {
  institutionCode: "UB",
  faculty: "FS",
  dept: "CSC",
  year: 2025,
  seq: 42,
  checkScheme: "none",
};

describe("expandMatricule", () => {
  it("expands tokens incl. year2 and padded seq", () => {
    expect(
      expandMatricule("{institutionCode}{faculty}{year2}-{seq:0000}", base),
    ).toBe("UBFS25-0042");
    expect(expandMatricule("{year}/{dept}/{seq}", base)).toBe("2025/CSC/42");
  });
  it("appends a luhn check when {check} present", () => {
    const out = expandMatricule("{faculty}{year2}-{seq:0000}{check}", {
      ...base,
      checkScheme: "luhn",
    });
    expect(out).toMatch(/^FS25-0042\d$/);
  });
  it("parses the admission year from a session name", () => {
    expect(admissionYear("2025/2026")).toBe(2025);
    expect(() => admissionYear("n/a")).toThrow();
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.**

```ts
/**
 * Matricule template expansion (WS C). Pure — sibling of TranscriptNumber.
 * Tokens: {institutionCode} {faculty} {dept} {year} {year2} {seq}/{seq:0000} {check}.
 */
import { computeCheck, type CheckScheme } from "./MatriculeCheck";

export interface MatriculeTokens {
  institutionCode?: string;
  faculty?: string;
  dept?: string;
  year: number;
  seq: number;
  checkScheme: CheckScheme;
}

export function admissionYear(session: string): number {
  const m = session.match(/(\d{4})/);
  if (!m) throw new Error(`Cannot parse admission year from "${session}".`);
  return Number(m[1]);
}

export function expandMatricule(template: string, t: MatriculeTokens): string {
  const body = template
    .replace(/\{institutionCode\}/g, t.institutionCode ?? "")
    .replace(/\{faculty\}/g, t.faculty ?? "")
    .replace(/\{dept\}/g, t.dept ?? "")
    .replace(/\{year2\}/g, String(t.year % 100).padStart(2, "0"))
    .replace(/\{year\}/g, String(t.year))
    .replace(/\{seq:(0+)\}/g, (_m, z: string) =>
      String(t.seq).padStart(z.length, "0"),
    )
    .replace(/\{seq\}/g, String(t.seq));
  // {check} is computed over the already-expanded body (with the token removed).
  const withoutCheck = body.replace(/\{check\}/g, "");
  const check = body.includes("{check}")
    ? computeCheck(t.checkScheme, withoutCheck)
    : "";
  return withoutCheck + check;
}
```

- [ ] **Step 4: Run → PASS.** Commit.

```bash
git add src/domain/services/Matricule.ts tests/domain/matricule-expand.test.ts
git commit -m "feat(domain): expandMatricule + admissionYear (pure)"
```

---

## Phase 2 — Counter & GenerateMatricule

### Task 2.1: `MatriculeCounter` repo port + Prisma impl

**Files:**

- Modify: `src/domain/repositories/records.ts` (append a port)
- Modify: `src/infrastructure/repositories/PrismaRecordsRepositories.ts` (impl)
- Modify: `src/application/ports/UnitOfWork.ts` + `src/infrastructure/persistence/PrismaUnitOfWork.ts` (add to the repos bundle)
- Test: `tests/students/matricule-counter.test.ts`

- [ ] **Step 1: Add the port** to `records.ts`:

```ts
/** Atomic per-(institution, faculty, year) matricule sequence (WS C). */
export interface MatriculeCounterRepository {
  /** Read the current next value WITHOUT incrementing (preview). 1 if none. */
  peek(
    institutionId: string | null,
    facultyId: string,
    year: number,
  ): Promise<number>;
  /** Reserve and return the next value, incrementing atomically. */
  reserve(
    institutionId: string | null,
    facultyId: string,
    year: number,
  ): Promise<number>;
}
```

- [ ] **Step 2: Write the failing impl test** (reuse the throwaway-SQLite harness from `tests/integration/persistence.integration.test.ts` / `tests/results/semester-ordering.test.ts`):

```ts
it("reserve increments per (faculty,year); peek does not", async () => {
  const repo = new PrismaMatriculeCounter(prisma);
  expect(await repo.peek(null, "facA", 2025)).toBe(1);
  expect(await repo.reserve(null, "facA", 2025)).toBe(1);
  expect(await repo.reserve(null, "facA", 2025)).toBe(2);
  expect(await repo.peek(null, "facA", 2025)).toBe(3); // peek shows next, no consume
  expect(await repo.reserve(null, "facB", 2025)).toBe(1); // independent scope
});
```

- [ ] **Step 3: Implement `PrismaMatriculeCounter`** (constructor takes the `Db`/transaction client like `PrismaSemesterOrdering`). `reserve` upserts then increments and returns the consumed value:

```ts
export class PrismaMatriculeCounter implements MatriculeCounterRepository {
  constructor(private readonly db: Db) {}
  async peek(institutionId: string | null, facultyId: string, year: number) {
    const row = await this.db.matriculeCounter.findUnique({
      where: {
        institutionId_facultyId_year: { institutionId, facultyId, year },
      },
    });
    return row?.next ?? 1;
  }
  async reserve(institutionId: string | null, facultyId: string, year: number) {
    const row = await this.db.matriculeCounter.upsert({
      where: {
        institutionId_facultyId_year: { institutionId, facultyId, year },
      },
      create: { institutionId, facultyId, year, next: 2 },
      update: { next: { increment: 1 } },
    });
    // After create, next=2 means we reserved 1; after update, returned next is the
    // value AFTER increment, so the reserved value is next-1.
    return row.next - 1;
  }
}
```

> Confirm the compound-unique accessor name Prisma generates
> (`institutionId_facultyId_year`) by checking the generated client / other repos.

- [ ] **Step 4: Add `matriculeCounter` to the `TransactionalRepos` type** (`UnitOfWork.ts`) and construct `new PrismaMatriculeCounter(tx)` in `PrismaUnitOfWork.ts` (mirror how `semesterOrdering` was added in WS B). Add a fake to `tests/results/fakes.ts` (an in-memory map keyed `${inst}:${fac}:${year}`) so use-case tests get one.

- [ ] **Step 5: Run → PASS;** `npx tsc --noEmit` clean.
- [ ] **Step 6: Commit.**

```bash
git add src/domain/repositories/records.ts src/infrastructure src/application/ports/UnitOfWork.ts tests
git commit -m "feat: MatriculeCounter repo (peek/reserve) + uow wiring"
```

### Task 2.2: `GenerateMatricule` application service

**Files:**

- Create: `src/application/services/GenerateMatricule.ts`
- Test: `tests/students/generate-matricule.test.ts`

- [ ] **Step 1: Write the failing test** (fakes for counter + lookups + settings):

```ts
it("reserves and expands using faculty code + admission year", async () => {
  const gen = makeGen({
    rule: "{faculty}{year2}-{seq:0000}",
    facultyCode: "FS",
  });
  const m = await gen.generate(
    { institutionId: null, facultyId: "facA", admissionSession: "2025/2026" },
    repos,
    "reserve",
  );
  expect(m).toBe("FS25-0001");
});
it("peek does not consume the counter", async () => {
  const gen = makeGen({
    rule: "{faculty}{year2}-{seq:0000}",
    facultyCode: "FS",
  });
  await gen.generate(ctx, repos, "peek");
  await gen.generate(ctx, repos, "peek");
  expect(await repos.matriculeCounter.peek(null, "facA", 2025)).toBe(1);
});
it("errors when the faculty has no code", async () => {
  const gen = makeGen({ rule: "{faculty}{year2}", facultyCode: undefined });
  await expect(gen.generate(ctx, repos, "reserve")).rejects.toThrow(/code/i);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** `GenerateMatricule` depends on a `GradingConfigService`-style settings reader (or the registry+settings repo) for the rule + check scheme, and on the transactional repos for the counter + faculty/dept/institution lookups. Resolve codes, parse year, peek/reserve, expand:

```ts
export type MatriculeMode = "peek" | "reserve";
export interface MatriculeContext {
  institutionId: string | null;
  facultyId: string;
  departmentId?: string;
  admissionSession: string;
}

export class GenerateMatricule {
  constructor(private readonly settings: MatriculeSettingsPort) {} // reads rule + scheme
  async generate(
    ctx: MatriculeContext,
    repos: TransactionalRepos,
    mode: MatriculeMode,
  ): Promise<string> {
    const rule = await this.settings.matriculeRule();
    const checkScheme = await this.settings.matriculeCheckScheme();
    const faculty = await repos.structure.findFacultyById(ctx.facultyId); // see note
    if (rule.includes("{faculty}") && !faculty?.code) {
      throw new RecordsError(
        "The selected faculty has no code for the matricule.",
      );
    }
    const dept = ctx.departmentId
      ? await repos.structure.findDepartmentById(ctx.departmentId)
      : null;
    const institution = await repos.institutions.get(); // or by ctx.institutionId
    const year = admissionYear(ctx.admissionSession);
    const seq =
      mode === "reserve"
        ? await repos.matriculeCounter.reserve(
            ctx.institutionId,
            ctx.facultyId,
            year,
          )
        : await repos.matriculeCounter.peek(
            ctx.institutionId,
            ctx.facultyId,
            year,
          );
    return expandMatricule(rule, {
      institutionCode: institution?.code,
      faculty: faculty?.code,
      dept: dept?.code,
      year,
      seq,
      checkScheme,
    });
  }
}
```

> Notes: (a) `MatriculeSettingsPort` is a tiny interface `{ matriculeRule(): Promise<string>; matriculeCheckScheme(): Promise<CheckScheme>; matriculeFormat(): Promise<string> }` implemented over `GetSetting`. (b) the plan needs faculty/department lookups inside the transaction — check `TransactionalRepos` for an existing structure repo (e.g. `repos.faculties`/`repos.departments` or a `structure` repo); if absent, add minimal `findFacultyById`/`findDepartmentById` reads to the relevant port and Prisma impl. Use whatever the composition already wires for faculty/department reads.

- [ ] **Step 4: Run → PASS;** tsc clean.
- [ ] **Step 5: Commit.**

```bash
git add src/application/services/GenerateMatricule.ts tests/students/generate-matricule.test.ts
git commit -m "feat(app): GenerateMatricule service (peek/reserve)"
```

---

## Phase 3 — Admission flow

### Task 3.1: `AdmitStudent` — admission session, auto/manual matricule, denormalized scope

**Files:**

- Modify: `src/application/use-cases/records/AdmitStudent.ts`
- Test: `tests/persistence/admit-student.test.ts` (extend) and/or `tests/records/manage-students.test.ts`

- [ ] **Step 1: Write failing tests.**

```ts
it("auto-generates the matricule, sets admissionSession + faculty/dept", async () => {
  const r = await admit({ fullName: "A", programmeId: "p", levelId: "l", facultyId: "facA", departmentId: "d", admissionSession: "2025/2026" });
  expect(r.student.matricNumber).toBe("FS25-0001");
  expect(r.student.admissionSession).toBe("2025/2026");
  expect(r.student.facultyId).toBe("facA");
});
it("uses a manual matricule and does NOT consume the counter", async () => {
  const r = await admit({ matricNumber: "MANUAL1", fullName: "A", programmeId: "p", levelId: "l", facultyId: "facA", admissionSession: "2025/2026" });
  expect(r.student.matricNumber).toBe("MANUAL1");
  expect(await repos.matriculeCounter.peek(null, "facA", 2025)).toBe(1);
});
it("rejects a manual matricule that fails the format regex", async () => {
  // settings matriculeFormat = "^[A-Z]{2}\\d{2}-\\d{4}$"
  await expect(admit({ matricNumber: "bad", ... })).rejects.toThrow(/format/i);
});
it("enforces faculty scope on the admitting officer", async () => {
  await expect(admit({ ...inFacB }, facABoundSession)).rejects.toBeInstanceOf(AuthorizationError);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Rewrite `AdmitStudent`.** New input: `admissionSession` required; `matricNumber?` optional; add `facultyId?`, `departmentId?`. Inject `GenerateMatricule` + the settings port. In the transaction: faculty-scope guard (`requireInFacultyScope(input.facultyId, session)`); resolve matricule (manual → validate non-empty + format regex; else `generate(reserve)`); uniqueness via `findByMatric`; create student with `admissionSession`, `facultyId`, `departmentId`, `previousStudentId?`; open enrollment `fromSession = admissionSession`.

```ts
export interface AdmitStudentInput {
  fullName: string;
  matricNumber?: string;
  regNumber?: string;
  programmeId: string;
  levelId: string;
  facultyId?: string;
  departmentId?: string;
  admissionSession: string;
  previousStudentId?: string;
}
// execute (inside uow.run):
if (input.facultyId) requireInFacultyScope(input.facultyId, session);
const ctx = {
  institutionId: null,
  facultyId: input.facultyId!,
  departmentId: input.departmentId,
  admissionSession: input.admissionSession,
};
let matric = input.matricNumber?.trim();
if (matric) {
  const fmt = await this.settings.matriculeFormat();
  if (fmt && !new RegExp(fmt).test(matric))
    throw new RecordsError("Matricule does not match the required format.", {
      matricNumber: "Invalid format.",
    });
} else {
  matric = await this.generate.generate(ctx, repos, "reserve");
}
if (await repos.students.findByMatric(matric))
  throw new RecordsError(`Matric number "${matric}" is already in use.`, {
    matricNumber: "Already in use.",
  });
const student = await repos.students.create({
  matricNumber: matric,
  fullName: input.fullName,
  regNumber: input.regNumber,
  programmeId: input.programmeId,
  levelId: input.levelId,
  ...(input.facultyId ? { facultyId: input.facultyId } : {}),
  ...(input.departmentId ? { departmentId: input.departmentId } : {}),
  ...(input.previousStudentId
    ? { previousStudentId: input.previousStudentId }
    : {}),
  admissionSession: input.admissionSession,
  status: "ACTIVE",
});
// ... enrollment + audit unchanged (fromSession = input.admissionSession) ...
```

> `Student` entity gains `previousStudentId?: string` (domain `index.ts`) — add it.

- [ ] **Step 4: Run → PASS;** full `npx vitest run` green (fix the contract/host/UI callers in Phase 9/10; the admit fakes need the counter + settings + structure lookups). tsc clean.
- [ ] **Step 5: Commit.**

```bash
git add src/application/use-cases/records/AdmitStudent.ts src/domain/entities/index.ts tests
git commit -m "feat(students): AdmitStudent admission session + auto/manual matricule + scope"
```

---

## Phase 4 — Import flow

### Task 4.1: `ImportStudents` — per-row matricule, admission session, faculty

**Files:**

- Modify: `src/application/use-cases/records/ImportStudents.ts`
- Test: `tests/records/import-students.test.ts` (find/extend)

- [ ] **Step 1: Write failing tests.**

```ts
it("generates matricules for rows that omit one, uses provided ones otherwise", async () => {
  const rep = await importRows(
    [{ name: "A" }, { matric: "GIVEN1", name: "B" }],
    { facultyId: "facA", admissionSession: "2025/2026" },
  );
  expect(rep.imported).toBe(2);
  // first row got FS25-0001; second kept GIVEN1
});
it("honors a per-row admissionSession and per-row faculty", async () => {
  const rep = await importRows(
    [{ name: "A", admissionSession: "2024/2025", faculty: "ART" }],
    { facultyId: "facA", admissionSession: "2025/2026" },
  );
  // row's matricule uses ART + 2024 counter; scope-checked against the officer
});
it("rolls back the counter when the batch fails validation", async () => {
  await importRows([{ name: "A" }, { name: "" /* invalid */ }], {
    facultyId: "facA",
    admissionSession: "2025/2026",
  });
  expect(await repos.matriculeCounter.peek(null, "facA", 2025)).toBe(1); // not advanced
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** In the commit loop (inside the existing single transaction): for each valid row, resolve its faculty (`str(row.faculty)` → faculty by code, scope-checked; else batch `facultyId`) and admission session (`str(row.admissionSession)` || batch); if the row supplied a matric use it (already de-duped), else `generate(reserve)` for that row's `(faculty, year)`; set `facultyId`/`departmentId`/`admissionSession` on create. Because generation happens inside the existing transaction, a thrown error (or the existing `errors.length>0` early return BEFORE the write loop) means no counter advance. Add per-row error messages for unparseable session / unknown-or-out-of-scope faculty / missing faculty code.

> Row-faculty resolution needs a code→faculty lookup in the transaction (reuse the structure read added in Task 2.2). Keep faculty batch-level when no row column is present.

- [ ] **Step 4: Run → PASS;** full suite green; tsc clean.
- [ ] **Step 5: Commit.**

```bash
git add src/application/use-cases/records/ImportStudents.ts tests/records/import-students.test.ts
git commit -m "feat(students): import per-row matricule/session/faculty (rollback-safe)"
```

---

## Phase 5 — Re-admission & preview

### Task 5.1: `WITHDRAWN → ACTIVE` transition (readmit path only)

**Files:**

- Modify: `src/domain/entities/student-status.ts`
- Test: `tests/domain/student-status.test.ts` (find/extend)

- [ ] **Step 1: Failing test:** `canTransition("WITHDRAWN","ACTIVE")` should be `true`; other WITHDRAWN transitions stay `false`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement:** change `WITHDRAWN: []` → `WITHDRAWN: ["ACTIVE"]`. (GRADUATED stays terminal for direct edits — graduate re-admission is a new record, Task 5.2.)
- [ ] **Step 4: Run → PASS.** Commit.

```bash
git add src/domain/entities/student-status.ts tests/domain/student-status.test.ts
git commit -m "feat(domain): allow WITHDRAWN→ACTIVE for re-admission"
```

### Task 5.2: `ReadmitStudent` use-case

**Files:**

- Create: `src/application/use-cases/records/ReadmitStudent.ts`
- Test: `tests/records/readmit-student.test.ts`

- [ ] **Step 1: Failing tests.**

```ts
it("WITHDRAWN: reactivates the SAME record, keeps matricule + admission session, opens enrollment", async () => {
  const r = await readmit({ studentId: "wd", programmeId: "p2", levelId: "l2", fromSession: "2026/2027" });
  expect(r.id).toBe("wd");
  expect(r.matricNumber).toBe(original.matricNumber);
  expect(r.admissionSession).toBe(original.admissionSession);
  expect(r.status).toBe("ACTIVE");
});
it("GRADUATED: creates a NEW record with a NEW matricule + admission session + previousStudentId", async () => {
  const r = await readmit({ studentId: "grad", programmeId: "p2", levelId: "l2", facultyId: "facA", fromSession: "2026/2027" });
  expect(r.id).not.toBe("grad");
  expect(r.previousStudentId).toBe("grad");
  expect(r.matricNumber).toBe("FS26-0001");
});
it("rejects readmit of an ACTIVE student", async () => {
  await expect(readmit({ studentId: "active", ... })).rejects.toThrow();
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** `ReadmitStudent` (`requiredPermissions ["students.update"]`, uow). Load the student; faculty-scope guard. If `WITHDRAWN`: set status ACTIVE (versioned patch path or `students.update`), then `openEnrollment(repos, session, "READMIT", { studentId, programmeId, levelId, fromSession })` (reuse the helper — export it from `ManageEnrollment.ts` or inline the same three writes). If `GRADUATED`: run the admission flow to create a NEW student (copy fullName/regNumber/gender/etc., set `previousStudentId`, new `admissionSession = fromSession`, auto matricule via `generate(reserve)`), open its enrollment. Else throw "Only withdrawn or graduated students can be re-admitted." Audited `READMIT`.

```ts
export interface ReadmitStudentInput {
  studentId: string;
  programmeId: string;
  levelId: string;
  fromSession: string;
  facultyId?: string;
  departmentId?: string;
}
```

> Reuse: export `openEnrollment` from `ManageEnrollment.ts`, and reuse `GenerateMatricule` for the graduate branch (same logic as `AdmitStudent`). Don't duplicate matricule logic.

- [ ] **Step 4: Run → PASS;** full suite green; tsc clean.
- [ ] **Step 5: Commit.**

```bash
git add src/application/use-cases/records/ReadmitStudent.ts src/application/use-cases/records/ManageEnrollment.ts tests/records/readmit-student.test.ts
git commit -m "feat(students): ReadmitStudent (withdrawn reuse / graduate new-record)"
```

### Task 5.3: `PreviewMatricule` use-case

**Files:**

- Create: `src/application/use-cases/records/PreviewMatricule.ts`
- Test: `tests/records/preview-matricule.test.ts`

- [ ] **Step 1: Failing test:** `preview({ facultyId, admissionSession })` returns the peek matricule and does NOT consume the counter; faculty-scoped.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** an AuthorizedUseCase (`students.read`) that runs `generate(ctx, repos, "peek")` in a read (it can use `uow.run` for repo access, but must not increment — `peek` doesn't). Returns `{ matricule }`. Faculty-scope guard on `facultyId`.
- [ ] **Step 4: Run → PASS.** Commit.

```bash
git add src/application/use-cases/records/PreviewMatricule.ts tests/records/preview-matricule.test.ts
git commit -m "feat(students): PreviewMatricule (non-consuming)"
```

---

## Phase 6 — Matricule regeneration on correction

### Task 6.1: `RegenerateMatricule` + `UpdateStudent.regenerateMatricule`

**Files:**

- Create: `src/application/use-cases/records/RegenerateMatricule.ts`
- Modify: `src/application/use-cases/records/ManageStudents.ts` (UpdateStudent: optional `regenerateMatricule` flag)
- Modify: `src/domain/repositories/transcripts.ts` (+ Prisma impl): add `countIssuedByStudent(studentId): Promise<number>` (APPROVED|LOCKED)
- Test: `tests/records/regenerate-matricule.test.ts`

- [ ] **Step 1: Failing tests.**

```ts
it("regenerates the matricule for the corrected admission year", async () => {
  // student admitted 2025/2026 (FS25-0007); correct to 2024/2025 + regenerate
  const r = await update({
    id: "s",
    patch: { admissionSession: "2024/2025" },
    regenerateMatricule: true,
  });
  expect(r.matricNumber).toBe("FS24-0001");
});
it("refuses regeneration when the student has issued transcripts", async () => {
  await expect(
    update({
      id: "withTranscript",
      patch: { admissionSession: "2024/2025" },
      regenerateMatricule: true,
    }),
  ).rejects.toThrow(/transcript/i);
});
it("a plain update (no flag) leaves the matricule unchanged", async () => {
  const r = await update({ id: "s", patch: { telephone: "x" } });
  expect(r.matricNumber).toBe(original.matricNumber);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** Add `regenerateMatricule?: boolean` to `UpdateStudentInput`. When set, after the patch, run a `RegenerateMatricule` step in the same transaction: refuse if `countIssuedByStudent > 0`; else `generate(reserve)` for the student's `(facultyId, corrected year)` and write the new `matricNumber` (the matricNumber-excluded patch type means regeneration writes it via a dedicated repo call — use `students.update(id, { matricNumber })` which is allowed at the repo level even though the use-case patch type excludes it). Audit the matricule change (old→new). Keep `RegenerateMatricule` logic in its own file and call it from `UpdateStudent` for reuse by bulk regen (Phase 8).

- [ ] **Step 4: Run → PASS;** full suite green; tsc clean.
- [ ] **Step 5: Commit.**

```bash
git add src/application/use-cases/records/RegenerateMatricule.ts src/application/use-cases/records/ManageStudents.ts src/domain/repositories/transcripts.ts src/infrastructure tests
git commit -m "feat(students): opt-in matricule regeneration on admission-session correction"
```

---

## Phase 7 — Student merge / de-duplication

### Task 7.1: Repo `reassignStudent` methods + `countLiveByStudent`

**Files:**

- Modify: `src/domain/repositories/records.ts` (Result + StudentEnrollment), `src/domain/repositories/transcripts.ts`
- Modify: their Prisma impls
- Test: covered via the MergeStudents test (7.2)

- [ ] **Step 1: Add port methods.** `ResultRepository.reassignStudent(fromId, toId): Promise<number>`; `StudentEnrollmentRepository.reassignStudent(fromId, toId): Promise<number>`; transcript repo `reassignStudent(fromId, toId): Promise<number>` + `listByStudent(studentId)` (if not present). Each updates live rows' `studentId` from→to and returns the count.

- [ ] **Step 2: Implement in Prisma** (`updateMany({ where: { studentId: fromId, deletedAt: null }, data: { studentId: toId } })`). Add fakes.

- [ ] **Step 3: Typecheck** clean. (No standalone commit — bundled with 7.2.)

### Task 7.2: `MergeStudents` + `FindDuplicateCandidates`

**Files:**

- Create: `src/application/use-cases/records/MergeStudents.ts`
- Test: `tests/records/merge-students.test.ts`

- [ ] **Step 1: Failing tests.**

```ts
it("re-points results/transcripts/enrollments and soft-deletes the duplicate", async () => {
  await merge({ survivingId: "keep", duplicateId: "dup" });
  expect(results.reassigned).toEqual({ from: "dup", to: "keep" });
  expect(await students.findById("dup")).toBeNull(); // soft-deleted (live read)
  expect((await students.findById("keep"))!.matricNumber).toBe(keepMatric); // survivor unchanged
});
it("refuses a conflicting merge (same course graded on both)", async () => {
  await expect(
    merge({ survivingId: "keep", duplicateId: "dupConflict" }),
  ).rejects.toThrow(/conflict/i);
});
it("enforces faculty scope on BOTH records", async () => {
  await expect(
    merge({ survivingId: "facA", duplicateId: "facB" }, facABoundSession),
  ).rejects.toBeInstanceOf(AuthorizationError);
});
it("findDuplicateCandidates surfaces previousStudentId links + exact-name matches", async () => {
  const pairs = await findCandidates({}, session);
  expect(pairs).toContainEqual(
    expect.objectContaining({
      survivingId: expect.any(String),
      duplicateId: expect.any(String),
    }),
  );
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `MergeStudents`** (`requiredPermissions ["students.manage"]`, uow). Load both; faculty-scope guard on both; **conflict check**: the duplicate must not have a `Result` for a `(courseId, semesterId, sitting)` that the survivor also has (re-pointing would violate the unique key / silently overwrite) — collect conflicts and throw a `RecordsError` listing them. Otherwise: `results.reassignStudent(dup, keep)`, `transcripts.reassignStudent(dup, keep)`, `enrollments.reassignStudent(dup, keep)`, `students.softDelete(dup)`, audit `MERGE` (record dup id + matricule). Implement `FindDuplicateCandidates` (`students.read`): scoped scan returning pairs where `previousStudentId` links two live records OR two live records share a normalized (trim+lowercase) `fullName`. Return `{ survivingId, duplicateId, reason }[]`.

> The conflict check needs the duplicate's + survivor's results — use `results.findByStudent` for each (already in the port).

- [ ] **Step 4: Run → PASS;** full suite green; tsc clean.
- [ ] **Step 5: Commit.**

```bash
git add src/domain/repositories src/infrastructure src/application/use-cases/records/MergeStudents.ts tests
git commit -m "feat(students): MergeStudents + FindDuplicateCandidates (conflict-refusing)"
```

---

## Phase 8 — Bulk matricule regeneration

### Task 8.1: `BulkRegenerateMatricules`

**Files:**

- Create: `src/application/use-cases/records/BulkRegenerateMatricules.ts`
- Test: `tests/records/bulk-regenerate.test.ts`

- [ ] **Step 1: Failing tests.**

```ts
it("regenerates matricules for in-scope students, skipping those with transcripts", async () => {
  const rep = await bulk({ facultyId: "facA", year: 2025 });
  expect(rep.regenerated).toBe(2);
  expect(rep.skipped).toContain("hasTranscript");
});
it("is faculty-scoped", async () => {
  await expect(
    bulk({ facultyId: "facB", year: 2025 }, facABoundSession),
  ).rejects.toBeInstanceOf(AuthorizationError);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** `BulkRegenerateMatricules` (`students.manage`, uow). Faculty-scope guard on `facultyId`. List live students in scope (`students.find({ where: { facultyId, ... } })` filtered to admission year == `year` by parsing `admissionSession`); for each without issued transcripts, reuse the `RegenerateMatricule` step (reserve + write + audit); collect `{ regenerated, skipped[] }`. One transaction.

- [ ] **Step 4: Run → PASS;** full suite green; tsc clean.
- [ ] **Step 5: Commit.**

```bash
git add src/application/use-cases/records/BulkRegenerateMatricules.ts tests/records/bulk-regenerate.test.ts
git commit -m "feat(students): BulkRegenerateMatricules (scoped, skips transcript-bearing)"
```

---

## Phase 9 — Contract / host / IPC / Zod wiring

### Task 9.1: Contract types

**Files:**

- Modify: `src/presentation/runtime/contract.ts`

- [ ] **Step 1:** Extend `admitStudent` input (`admissionSession` required, optional `matricNumber`, `facultyId`/`departmentId`, `previousStudentId`); add `regenerateMatricule?` to the `updateStudent` input. Add methods: `previewMatricule({ facultyId, admissionSession }): Promise<{ matricule: string }>`; `readmitStudent(input): Promise<StudentView>`; `findDuplicateCandidates(input): Promise<{ survivingId; duplicateId; reason }[]>`; `mergeStudents({ survivingId, duplicateId }): Promise<{ ok: true }>`; `bulkRegenerateMatricules({ facultyId, year }): Promise<{ regenerated: number; skipped: string[] }>`. Mirror the WS B `saveCourseResults`/`listCourseRoster` additions.
- [ ] **Step 2:** Typecheck (surfaces mock/ipc/host gaps).
- [ ] **Step 3: Commit.**

```bash
git add src/presentation/runtime/contract.ts
git commit -m "feat(contract): matricule/admission/readmit/merge/bulk methods"
```

### Task 9.2: Zod schemas

**Files:**

- Modify: `src/host/inputSchemas.ts`

- [ ] **Step 1: Add schemas** (mirror existing entries; `str = z.string()`):

```ts
admitStudent: z.looseObject({ fullName: str, admissionSession: str, programmeId: str, levelId: str }),
previewMatricule: z.looseObject({ facultyId: str, admissionSession: str }),
readmitStudent: z.looseObject({ studentId: str, programmeId: str, levelId: str, fromSession: str }),
mergeStudents: z.looseObject({ survivingId: str, duplicateId: str }),
findDuplicateCandidates: z.looseObject({}),
bulkRegenerateMatricules: z.looseObject({ facultyId: str, year: z.number() }),
```

- [ ] **Step 2:** Run `npx vitest run tests/host` (if present) → PASS.
- [ ] **Step 3: Commit.**

```bash
git add src/host/inputSchemas.ts
git commit -m "feat(host): zod schemas for WS C methods"
```

### Task 9.3: Compose + register + ipcClient + harness

**Files:**

- Modify: `src/host/composition.ts`, `src/presentation/runtime/ipcClient.ts`, `tests/ui/harness.tsx`

- [ ] **Step 1:** Construct `GenerateMatricule` (+ its settings port over `GetSetting`), wire it into `AdmitStudent`, `ReadmitStudent`, `PreviewMatricule`, `RegenerateMatricule`, `BulkRegenerateMatricules`. Register registry thunks via `authorize(useCase, input, session)` for `previewMatricule`/`readmitStudent`/`findDuplicateCandidates`/`mergeStudents`/`bulkRegenerateMatricules` and re-wire the existing `admitStudent`/`updateStudent` to the updated use-cases.
- [ ] **Step 2:** Add `ipcClient` methods (forward to dispatch) and `makeCore` defaults in `harness.tsx` (`previewMatricule: async () => ({ matricule: "" })`, `readmitStudent: async () => ({}) as never`, `findDuplicateCandidates: async () => []`, `mergeStudents: async () => ({ ok: true as const })`, `bulkRegenerateMatricules: async () => ({ regenerated: 0, skipped: [] })`).
- [ ] **Step 3:** `npx tsc --noEmit` clean; `npx vitest run tests/ui` green.
- [ ] **Step 4: Commit.**

```bash
git add src/host/composition.ts src/presentation/runtime/ipcClient.ts tests/ui/harness.tsx
git commit -m "feat(host): wire WS C use-cases + client methods"
```

---

## Phase 10 — UI

### Task 10.1: Admit form — admission session + matricule preview/override

**Files:**

- Modify: `src/presentation/screens/StudentsScreen.tsx` (AdmitModal)
- Test: `tests/ui/students.test.tsx` (find/extend)

- [ ] **Step 1: Failing tests.** Admission session select drives a `previewMatricule` call; an "Enter manually" toggle reveals a matric text input and auto omits `matricNumber`; on auto submit, `admitStudent` is called WITHOUT `matricNumber` and the success path shows the returned matricule. Use accessible labels (aria-label "Admission session", "Matricule").
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Add the preview (calls `core.previewMatricule({ facultyId, admissionSession })` when both set), the manual toggle, and pass `admissionSession`/`facultyId`/`departmentId` (+ optional manual `matricNumber`) to `core.admitStudent`. Show the issued matricule after success. Reuse existing form primitives.
- [ ] **Step 4: Run → PASS;** full suite green; tsc clean.
- [ ] **Step 5: Commit.**

```bash
git add src/presentation/screens/StudentsScreen.tsx tests/ui/students.test.tsx
git commit -m "feat(ui): admit matricule preview + manual override + admission session"
```

### Task 10.2: Config template editor + readmit/graduate modal + regenerate checkbox

**Files:**

- Modify: `src/presentation/screens/ConfigurationScreen.tsx` (template editor)
- Modify: `src/presentation/screens/StudentsScreen.tsx` (readmit action + edit-form regenerate checkbox)
- Test: `tests/ui/configuration.test.tsx`, `tests/ui/students.test.tsx`

- [ ] **Step 1: Failing tests.** Config editor binds `student.matriculeRule`/`matriculeCheckScheme`/`matriculeFormat` (saves via `setSetting`) and shows a live sample. A "Readmit" action on a withdrawn/graduated student calls `readmitStudent`. The edit form's admission-session correction shows a "regenerate matricule" checkbox that sets `updateStudent.regenerateMatricule`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Template editor (text input + `getSetting`/`setSetting`, scheme `<select>`, format input, live sample computed via a small client-side expand or a `previewMatricule`-style call). Readmit modal (programme/level/session; read-only matric/session for withdrawn; "fresh admission" note for graduate). Regenerate checkbox wired into the update payload.
- [ ] **Step 4: Run → PASS;** full suite green; tsc clean.
- [ ] **Step 5: Commit.**

```bash
git add src/presentation/screens tests/ui
git commit -m "feat(ui): matricule config editor, readmit/graduate modal, regenerate checkbox"
```

### Task 10.3: Merge + bulk-regen UI (operator-confirmed)

**Files:**

- Create: `src/presentation/screens/StudentMaintenanceScreen.tsx` (or a section of StudentsScreen)
- Test: `tests/ui/student-maintenance.test.tsx`

- [ ] **Step 1: Failing tests.** A "Possible duplicates" list (`findDuplicateCandidates`) → selecting a pair opens a **confirmation dialog** (uses the existing `DialogProvider` confirm) showing survivor + what moves; confirming calls `mergeStudents({ survivingId, duplicateId })`; cancelling does NOT. A bulk-regen panel picks faculty+year, shows counts, and on confirm calls `bulkRegenerateMatricules`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Reuse the `DialogProvider` confirm pattern (see `tests/ui/harness.tsx` wrapping). The merge button is disabled until a pair is selected; the confirm dialog spells out the survivor and the duplicate's matricule. Bulk-regen shows a preview/confirm. Both gated by `students.manage` (hide when the session lacks it).
- [ ] **Step 4: Run → PASS;** full suite green; tsc clean.
- [ ] **Step 5: Commit.**

```bash
git add src/presentation/screens/StudentMaintenanceScreen.tsx tests/ui/student-maintenance.test.tsx
git commit -m "feat(ui): operator-confirmed merge + bulk matricule regeneration"
```

---

## Phase 11 — Verify, docs & rebuild

### Task 11.1: Full verification

- [ ] **Step 1:** `npx tsc --noEmit` (clean); `npx eslint src tests --quiet` (clean); `npx prettier --check "src/**/*.{ts,tsx}" "tests/**/*.{ts,tsx}"` (clean — `--write` if not); `npx vitest run` (all green, count > pre-C).
- [ ] **Step 2:** Architecture fitness (`tests/architecture.test.ts`) — confirm `Matricule.ts`, `MatriculeCheck.ts` stay framework-free.

### Task 11.2: Docs

**Files:**

- Modify: `docs/superpowers/specs/2026-06-20-student-identity-matricule-design.md` (Status → Implemented; tick §8 DoD)

- [ ] **Step 1:** Flip Status + tick the satisfied DoD boxes. Commit `docs: mark Workstream C implemented`.

### Task 11.3: Rebuild & reinstall

- [ ] **Step 1:** `npm run tauri build` — expect the MSI/EXE bundles written (the `TAURI_SIGNING_PRIVATE_KEY` updater step may exit non-zero AFTER the installers are produced; the artifacts are still valid). The new migration auto-bundles via `tauri.conf.json`.
- [ ] **Step 2:** Reinstall from the MSI; smoke test: configure a matricule rule, admit a student (auto matricule preview + issued value), readmit a withdrawn student, and run a merge with confirmation.

---

## Self-review notes (coverage map)

- **Spec §2 data model** → 0.1–0.3 (counter, previousStudentId, migration), 0.4 (settings).
- **Spec §3 generator** → 1.1 (check schemes), 1.2 (expand + year), 2.1 (counter), 2.2 (GenerateMatricule peek/reserve).
- **Spec §4 admission + scenarios** → 3.1 (admit), 5.1–5.2 (readmit withdrawn/graduate), 6.1 (regeneration).
- **Spec §4 merge + bulk regen** → 7.1–7.2 (merge + candidates), 8.1 (bulk).
- **Spec §5 import** → 4.1.
- **Spec §6 UI** → 10.1 (admit), 10.2 (config/readmit/regenerate), 10.3 (merge/bulk).
- **Spec §7 testing/security** → TDD throughout + 11.1; faculty-scope guards in 3.1/5.2/6.1/7.2/8.1.
- **Spec §1.1/§1.2 decisions** → tokens (1.2), seq scope (2.1), immutable session (3.1), check scheme (1.1/0.4), per-row faculty (4.1), graduate new-record (5.2), regeneration (6.1), merge (7.2), bulk (8.1).

**Type-consistency checks:** `MatriculeTokens`/`CheckScheme` (1.1/1.2) consumed identically by `GenerateMatricule` (2.2); `MatriculeCounterRepository.peek/reserve` (2.1) called by 2.2/3.1/5.2/6.1/8.1; `reassignStudent(fromId,toId)` (7.1) used by 7.2; contract methods (9.1) match use-case shapes (3.1/5.x/6.1/7.2/8.1) and UI calls (10.x).

**Flagged verify-points (not blockers):** `SettingsRegistry.validate(key,value)` accessor name (0.4); the Prisma compound-unique accessor `institutionId_facultyId_year` (2.1); whether `TransactionalRepos` already exposes faculty/department reads or needs minimal `findFacultyById`/`findDepartmentById` (2.2); the transcript repo's existing method set for `countIssuedByStudent`/`reassignStudent` (6.1/7.1); the `DialogProvider` confirm API for the merge dialog (10.3).
