# Bulk Course Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import courses from a spreadsheet (Course code | Course title | Credit Value | Course type) scoped per programme/level/semester, upserting each row, with a downloadable template on both the course and student import screens.

**Architecture:** A dedicated `ImportCourses` application use-case mirroring `ImportStudents` (batch placement + per-row alias parsing, validation pass then write pass in one `uow.run` transaction, upsert via `repos.courses.findByCode`/`create`/`update`, created/updated report). A pure client-side `downloadCsvTemplate` helper, a new `ImportCoursesScreen`, a retrofit of the student screen, and a relaxed `parseWorkbook` host gate (authenticated-only). No schema/migration changes.

**Tech Stack:** TypeScript (strict), Vitest, React 19 + Tauri, Zod.

**Spec:** `docs/superpowers/specs/2026-06-21-course-import-design.md`

**Conventions:**

- Test one file: `npx vitest run tests/<path>`. Full: `npx vitest run`. Typecheck: `npx tsc --noEmit`. Lint: `npx eslint src tests --quiet`.
- A lint-staged hook auto-runs prettier/eslint on commit. End commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Work on branch `feat/eartmp-phases-0-5`. Do NOT use a git worktree.** After each commit, `git log --oneline -1` to confirm it landed.

**Verified facts:**

- `ImportStudents` (`src/application/use-cases/records/ImportStudents.ts`) is the reference: `str()` helper, validation-then-write in `this.uow.run`, `StudentImportReport`, batch-level placement, `repos.students.findByMatric` in the validation pass.
- `ManageCourses.ts` has `const COURSE_TYPES: readonly CourseType[] = ["CORE","ELECTIVE","PRACTICAL","CLINICAL"]` (currently **not exported**), validates `creditValue` positive integer + `courseType` in `COURSE_TYPES`.
- `TransactionalRepos.courses` (`CourseRepository`) has `create(Omit<Course,"id">)`, `update(id, Partial<Omit<Course,"id">>)`, `findByCode(code): Promise<Course|null>` (live rows). `Course = { id, code, title, creditValue, courseType, departmentId?, subDepartmentId?, programmeId?, levelId?, institutionId?, semesterRank? }`. `code` is globally unique among live rows.
- `parseWorkbook` registered at `src/host/composition.ts:865` with `requirePerm(s, "results.import")`; `requirePerm(session, perm)` is at `composition.ts:240`.
- `ImportStudentsScreen.tsx` is the UI reference (cascade selects via `core.listFaculties/listDepartments/listSubDepartments/listSessions`, `fileToBase64` → `core.parseWorkbook({ base64 })`, `useAction`/`useAsync` hooks, `Button/Card/Badge/Field/Toast/EmptyState` from `../components/ui`). Course cascade uses `core.listDepartments`/`listProgrammes`/`listLevels`.
- Nav is `src/presentation/components/AppShell.tsx` (NAV array + `Route` union + TITLES) and `src/presentation/App.tsx` (route→component chain + SCREEN_NAMES). A `students.create`-gated entry exists for import.

---

## Phase 0 — `ImportCourses` use-case

### Task 0.1: Export `COURSE_TYPES`

**Files:**

- Modify: `src/application/use-cases/records/ManageCourses.ts` (line ~19)

- [ ] **Step 1:** Add `export` to the constant so the importer reuses it:

```ts
export const COURSE_TYPES: readonly CourseType[] = [
  "CORE",
  "ELECTIVE",
  "PRACTICAL",
  "CLINICAL",
];
```

- [ ] **Step 2:** `npx tsc --noEmit` clean.
- [ ] **Step 3: Commit.**

```bash
git add src/application/use-cases/records/ManageCourses.ts
git commit -m "refactor(courses): export COURSE_TYPES for reuse"
```

### Task 0.2: `ImportCourses` use-case

**Files:**

- Create: `src/application/use-cases/records/ImportCourses.ts`
- Test: `tests/records/import-courses.test.ts`

- [ ] **Step 1: Write the failing tests.** Build an in-memory `courses` fake + `fakeUow` (mirror how `tests/records/import-students.test.ts` builds its fake repos/uow; the courses fake needs `findByCode`, `create`, `update`). An admin session: `SessionContext.create("a","SUPER_ADMIN",["courses.create","courses.update"])`.

```ts
import { describe, it, expect, vi } from "vitest";
import { ImportCourses } from "../../src/application/use-cases/records/ImportCourses";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";

const admin = SessionContext.create("a", "SUPER_ADMIN", [
  "courses.create",
  "courses.update",
]);

// A fake CourseRepository + uow: store courses by code; capture create/update calls.
function makeFakes() {
  const store = new Map<
    string,
    {
      id: string;
      code: string;
      title: string;
      creditValue: number;
      courseType: string;
      programmeId?: string;
      levelId?: string;
      semesterRank?: number;
      departmentId?: string;
    }
  >();
  let seq = 0;
  const courses = {
    async findByCode(code: string) {
      return store.get(code.toLowerCase()) ?? null;
    },
    create: vi.fn(async (data: any) => {
      const row = { id: `c${++seq}`, ...data };
      store.set(String(data.code).toLowerCase(), row);
      return row;
    }),
    update: vi.fn(async (id: string, patch: any) => {
      const row = [...store.values()].find((c) => c.id === id)!;
      Object.assign(row, patch);
      return row;
    }),
  };
  const audit = { record: vi.fn(async () => {}) };
  const uow = { run: async (work: any) => work({ courses, audit }) };
  return { courses, audit, uow, store };
}

describe("ImportCourses", () => {
  it("creates new courses and reports created count", async () => {
    const { courses, uow } = makeFakes();
    const uc = new ImportCourses(uow as never);
    const r = await uc.execute(
      {
        rows: [
          {
            "Course code": "PHY101",
            "Course title": "Physics I",
            "Credit Value": 3,
            "Course type": "Core",
          },
        ],
        programmeId: "p",
        levelId: "l",
        semesterRank: 1,
      },
      admin,
    );
    expect(r).toMatchObject({
      totalRows: 1,
      validRows: 1,
      created: 1,
      updated: 0,
      errors: [],
    });
    expect(courses.create).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "PHY101",
        title: "Physics I",
        creditValue: 3,
        courseType: "CORE",
        programmeId: "p",
        levelId: "l",
        semesterRank: 1,
      }),
    );
  });

  it("upserts an existing code (updates fields + re-places) and reports updated", async () => {
    const { courses, store, uow } = makeFakes();
    store.set("phy101", {
      id: "c0",
      code: "PHY101",
      title: "Old",
      creditValue: 2,
      courseType: "CORE",
    });
    const uc = new ImportCourses(uow as never);
    const r = await uc.execute(
      {
        rows: [
          {
            code: "PHY101",
            title: "New",
            creditValue: 4,
            courseType: "ELECTIVE",
          },
        ],
        programmeId: "p2",
        levelId: "l2",
        semesterRank: 2,
      },
      admin,
    );
    expect(r).toMatchObject({ created: 0, updated: 1, errors: [] });
    expect(courses.update).toHaveBeenCalledWith(
      "c0",
      expect.objectContaining({
        title: "New",
        creditValue: 4,
        courseType: "ELECTIVE",
        programmeId: "p2",
        levelId: "l2",
        semesterRank: 2,
      }),
    );
  });

  it("flags in-file duplicate codes, invalid type, and non-positive credit", async () => {
    const { uow } = makeFakes();
    const uc = new ImportCourses(uow as never);
    const r = await uc.execute(
      {
        rows: [
          { code: "C1", title: "A", creditValue: 3, courseType: "CORE" },
          { code: "C1", title: "B", creditValue: 3, courseType: "CORE" }, // dup in file
          { code: "C2", title: "C", creditValue: 0, courseType: "CORE" }, // bad credit
          { code: "C3", title: "D", creditValue: 3, courseType: "BOGUS" }, // bad type
        ],
      },
      admin,
    );
    expect(r.errors.map((e) => e.row)).toEqual([2, 3, 4]);
    expect(r.created).toBe(0); // any error → nothing written
  });

  it("dry-run validates but writes nothing", async () => {
    const { courses, uow } = makeFakes();
    const uc = new ImportCourses(uow as never);
    const r = await uc.execute(
      {
        rows: [{ code: "X1", title: "X", creditValue: 3, courseType: "CORE" }],
        dryRun: true,
      },
      admin,
    );
    expect(r.validRows).toBe(1);
    expect(r.created).toBe(0);
    expect(courses.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run → FAIL** (`Cannot find module`).

- [ ] **Step 3: Implement** `src/application/use-cases/records/ImportCourses.ts`:

```ts
/**
 * ImportCourses — bulk-import courses from already-parsed spreadsheet rows,
 * scoped to a chosen programme / level / semester (and department). Each row is
 * UPSERTED: an existing code updates that course (+ re-places it to the batch
 * placement), a new code creates it. Validation + writes run in ONE transaction
 * (all-or-nothing, mirrors ImportStudents). Gated + audited.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import type { CourseType } from "../../../domain/entities";
import { COURSE_TYPES } from "./ManageCourses";
import type { RawRow } from "../../ports/SpreadsheetReaderPort";
import type { UnitOfWork } from "../../ports/UnitOfWork";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

export interface ImportCoursesInput {
  rows: RawRow[];
  programmeId?: string;
  levelId?: string;
  semesterRank?: number;
  departmentId?: string;
  dryRun?: boolean;
}
export interface CourseImportRowError {
  row: number;
  messages: string[];
}
export interface CourseImportReport {
  totalRows: number;
  validRows: number;
  created: number;
  updated: number;
  errors: CourseImportRowError[];
}

interface ValidCourse {
  code: string;
  title: string;
  creditValue: number;
  courseType: CourseType;
  existingId?: string;
}

function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v).trim();
}

export class ImportCourses implements AuthorizedUseCase<
  ImportCoursesInput,
  CourseImportReport
> {
  readonly name = "ImportCourses";
  readonly requiredPermissions = ["courses.create", "courses.update"];

  constructor(private readonly uow: UnitOfWork) {}

  async execute(
    input: ImportCoursesInput,
    session: SessionContext,
  ): Promise<CourseImportReport> {
    return this.uow.run(async (repos) => {
      const seen = new Set<string>();
      const errors: CourseImportRowError[] = [];
      const valid: ValidCourse[] = [];

      for (let i = 0; i < input.rows.length; i++) {
        const row = input.rows[i]!;
        const messages: string[] = [];
        const code = str(row.code ?? row["Course code"] ?? row.courseCode);
        const title = str(row.title ?? row["Course title"] ?? row.name);
        const creditValue = Number(
          row.creditValue ?? row["Credit Value"] ?? row.credits,
        );
        const courseType = str(
          row.courseType ?? row["Course type"] ?? row.type,
        ).toUpperCase();

        if (!code) messages.push("Missing course code.");
        if (!title) messages.push("Missing course title.");
        if (!Number.isInteger(creditValue) || creditValue <= 0) {
          messages.push("Credit value must be a positive integer.");
        }
        if (!(COURSE_TYPES as readonly string[]).includes(courseType)) {
          messages.push(`Invalid course type "${courseType}".`);
        }

        let existingId: string | undefined;
        if (code) {
          const key = code.toLowerCase();
          if (seen.has(key)) {
            messages.push("Duplicate course code within the file.");
          } else {
            seen.add(key);
            const existing = await repos.courses.findByCode(code);
            if (existing) existingId = existing.id;
          }
        }

        if (messages.length > 0) {
          errors.push({ row: i + 1, messages });
        } else {
          valid.push({
            code,
            title,
            creditValue,
            courseType: courseType as CourseType,
            ...(existingId ? { existingId } : {}),
          });
        }
      }

      const base: CourseImportReport = {
        totalRows: input.rows.length,
        validRows: valid.length,
        created: 0,
        updated: 0,
        errors,
      };
      if (input.dryRun || errors.length > 0) return base;

      const placement = {
        ...(input.programmeId ? { programmeId: input.programmeId } : {}),
        ...(input.levelId ? { levelId: input.levelId } : {}),
        ...(input.departmentId ? { departmentId: input.departmentId } : {}),
        ...(input.semesterRank !== undefined
          ? { semesterRank: input.semesterRank }
          : {}),
      };

      let created = 0;
      let updated = 0;
      for (const v of valid) {
        if (v.existingId) {
          await repos.courses.update(v.existingId, {
            title: v.title,
            creditValue: v.creditValue,
            courseType: v.courseType,
            ...placement,
          });
          updated++;
        } else {
          await repos.courses.create({
            code: v.code,
            title: v.title,
            creditValue: v.creditValue,
            courseType: v.courseType,
            ...placement,
          });
          created++;
        }
      }

      await repos.audit.record({
        userId: session.actorId,
        action: "IMPORT",
        entity: "Course",
        recordId: input.programmeId ?? input.departmentId ?? "bulk",
        newValue: {
          created,
          updated,
          programmeId: input.programmeId ?? null,
          levelId: input.levelId ?? null,
          semesterRank: input.semesterRank ?? null,
        },
      });

      return { ...base, created, updated };
    });
  }
}
```

> Note: `repos.courses.create` takes `Omit<Course, "id">`; `code/title/creditValue/courseType` are required and the rest optional, so the placement spread satisfies it. If `TransactionalRepos` does not expose `audit`/`courses` exactly as named, match the real field names (see `src/application/ports/UnitOfWork.ts`).

- [ ] **Step 4: Run → PASS;** `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit.**

```bash
git add src/application/use-cases/records/ImportCourses.ts tests/records/import-courses.test.ts
git commit -m "feat(courses): ImportCourses use-case (upsert, all-or-nothing)"
```

---

## Phase 1 — Relax `parseWorkbook` gating

### Task 1.1: `parseWorkbook` requires only authentication

**Files:**

- Modify: `src/host/composition.ts` (the `parseWorkbook` registry entry, ~line 865)
- Test: `tests/host/parse-workbook-auth.test.ts` (or extend an existing host/dispatch test — find with `grep -rl "parseWorkbook\|createCore" tests`)

- [ ] **Step 1: Read** `composition.ts:240` (`requirePerm`) and the `parseWorkbook` entry. Confirm the `AuthenticationError`/`AuthorizationError` imports available.

- [ ] **Step 2: Implement.** Replace the permission check in the `parseWorkbook` thunk so it only requires an authenticated session:

```ts
registry.set("parseWorkbook", async (i, s) => {
  if (!s) throw new AuthenticationError("Authentication required.");
  const bytes = new Uint8Array(
    Buffer.from((i as { base64: string }).base64, "base64"),
  );
  return new SheetJsReader().read(bytes);
});
```

(Import `AuthenticationError` from `../domain/errors/auth` if not already imported.)

- [ ] **Step 3: Write a test** driving the host so a session that holds neither `results.import` succeeds. Build a tiny CSV workbook in base64 (`"code,title\nC1,Course"` → `Buffer.from(...).toString("base64")`) and dispatch `parseWorkbook` with an authenticated non-import session. Mirror how an existing host/dispatch test constructs the host (`createCore(host)` / `dispatch`). Assert it returns the parsed rows (and that a `null`/unauthenticated session is rejected). If no host-dispatch harness exists, instead assert the registry handler resolves for an authenticated session via the composed `host.registry.get("parseWorkbook")`.

```ts
it("parseWorkbook works for an authenticated session lacking results.import", async () => {
  // ...compose the host (see other host tests)...
  const csv = Buffer.from("code,title\nC1,Course").toString("base64");
  const registrar = makeSession(["courses.create"]); // no results.import
  const rows = await dispatchParseWorkbook({ base64: csv }, registrar);
  expect(rows).toEqual([{ code: "C1", title: "Course" }]);
});
```

- [ ] **Step 4: Run → PASS;** `npx vitest run tests/host` + `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit.**

```bash
git add src/host/composition.ts tests/host/parse-workbook-auth.test.ts
git commit -m "fix(host): parseWorkbook needs only authentication (unblocks non-results importers)"
```

---

## Phase 2 — Template helper

### Task 2.1: `downloadCsvTemplate`

**Files:**

- Create: `src/presentation/screens/import/csvTemplate.ts`
- Test: `tests/ui/csv-template.test.ts`

- [ ] **Step 1: Write the failing test** (assert the produced CSV text; the download side-effect is stubbed):

```ts
import { describe, it, expect, vi } from "vitest";
import { buildCsvTemplateText } from "../../src/presentation/screens/import/csvTemplate";

describe("csv template", () => {
  it("builds a header-only CSV from the given headers", () => {
    expect(
      buildCsvTemplateText([
        "Course code",
        "Course title",
        "Credit Value",
        "Course type",
      ]),
    ).toBe("Course code,Course title,Credit Value,Course type\n");
  });
  it("quotes a header containing a comma", () => {
    expect(buildCsvTemplateText(["a,b", "c"])).toBe('"a,b",c\n');
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** (split the pure text-builder from the DOM side-effect so the builder is unit-testable):

```ts
/** Pure: build the header-only CSV text for an import template. */
export function buildCsvTemplateText(headers: string[]): string {
  const cell = (h: string) =>
    /[",\n]/.test(h) ? `"${h.replace(/"/g, '""')}"` : h;
  return headers.map(cell).join(",") + "\n";
}

/** Trigger a browser download of a header-only CSV template. */
export function downloadCsvTemplate(filename: string, headers: string[]): void {
  const blob = new Blob([buildCsvTemplateText(headers)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const COURSE_TEMPLATE_HEADERS = [
  "Course code",
  "Course title",
  "Credit Value",
  "Course type",
];
export const STUDENT_TEMPLATE_HEADERS = [
  "matricNumber",
  "fullName",
  "regNumber",
  "gender",
  "nationality",
];
```

- [ ] **Step 4: Run → PASS;** tsc clean.
- [ ] **Step 5: Commit.**

```bash
git add src/presentation/screens/import/csvTemplate.ts tests/ui/csv-template.test.ts
git commit -m "feat(ui): downloadable CSV template helper"
```

---

## Phase 3 — Contract / host / zod / ipc / harness wiring

### Task 3.1: Contract + Zod + register + ipc + harness

**Files:**

- Modify: `src/presentation/runtime/contract.ts`, `src/host/inputSchemas.ts`, `src/host/composition.ts`, `src/presentation/runtime/ipcClient.ts`, `tests/ui/harness.tsx`

- [ ] **Step 1: Contract.** Add the report types + method to `contract.ts` (reuse `RawRow`):

```ts
export interface CourseImportRowError { row: number; messages: string[]; }
export interface CourseImportReport {
  totalRows: number;
  validRows: number;
  created: number;
  updated: number;
  errors: CourseImportRowError[];
}
// ...in CoreApi:
importCourses(input: {
  rows: RawRow[];
  programmeId?: string;
  levelId?: string;
  semesterRank?: number;
  departmentId?: string;
  dryRun?: boolean;
}): Promise<CourseImportReport>;
```

- [ ] **Step 2: Zod** (`inputSchemas.ts`, mirror `importStudents` / the file's `z.looseObject`/`z.array` style):

```ts
importCourses: z.looseObject({
  rows: z.array(z.looseObject({})),
  programmeId: optStr,
  levelId: optStr,
  semesterRank: z.number().optional(),
  departmentId: optStr,
  dryRun: z.boolean().optional(),
}),
```

- [ ] **Step 3: Compose + register** (`composition.ts`): `const importCourses = new ImportCourses(uow);` then `registry.set("importCourses", (i, s) => authorize(importCourses, i as never, s));`.

- [ ] **Step 4: ipcClient + harness.** Add `importCourses` forwarding to `ipcClient.ts`; add a `makeCore` default in `harness.tsx`: `importCourses: async () => ({ totalRows: 0, validRows: 0, created: 0, updated: 0, errors: [] }),`.

- [ ] **Step 5:** `npx tsc --noEmit` clean; `npx vitest run tests/ui tests/host` green.
- [ ] **Step 6: Commit.**

```bash
git add src/presentation/runtime/contract.ts src/host/inputSchemas.ts src/host/composition.ts src/presentation/runtime/ipcClient.ts tests/ui/harness.tsx
git commit -m "feat(host): wire importCourses"
```

---

## Phase 4 — UI

### Task 4.1: `ImportCoursesScreen` + nav

**Files:**

- Create: `src/presentation/screens/ImportCoursesScreen.tsx`
- Modify: `src/presentation/components/AppShell.tsx` (Route + NAV + TITLES), `src/presentation/App.tsx` (import + route branch + SCREEN_NAMES)
- Test: `tests/ui/import-courses.test.tsx`

- [ ] **Step 1: Write failing tests** (renderScreen with permissions `["courses.create","courses.update","structure.read"]`; stub `listDepartments`/`listProgrammes`/`listLevels`/`parseWorkbook`/`importCourses`):

```ts
it("downloads a template", async () => {
  // spy on the anchor click OR on URL.createObjectURL; click the "Download template" button
});
it("validates then commits, calling importCourses with the scope", async () => {
  const importCourses = vi.fn(async () => ({ totalRows: 1, validRows: 1, created: 1, updated: 0, errors: [] }));
  const { user } = renderScreen(<ImportCoursesScreen />, {
    permissions: ["courses.create","courses.update","structure.read"],
    core: {
      listDepartments: async () => [{ id: "d1", name: "Sci" } as never],
      listProgrammes: async () => [{ id: "p1", name: "CS" } as never],
      listLevels: async () => [{ id: "l1", name: "100" } as never],
      parseWorkbook: async () => [{ "Course code": "C1", "Course title": "X", "Credit Value": 3, "Course type": "CORE" }],
      importCourses,
    },
  });
  // pick department/programme/level/semester=1, upload a file (simulate onFile via the file input), Validate, then Commit
  await waitFor(() => expect(importCourses).toHaveBeenCalledWith(expect.objectContaining({ programmeId: "p1", levelId: "l1", semesterRank: 1, dryRun: true })));
  // ...after commit...
  await waitFor(() => expect(importCourses).toHaveBeenCalledWith(expect.objectContaining({ programmeId: "p1", levelId: "l1", semesterRank: 1 })));
});
it("hides the screen actions without courses.create", async () => { /* permissions ["structure.read"] → no nav/screen */ });
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `ImportCoursesScreen.tsx` — copy the structure of `ImportStudentsScreen.tsx`, changing: the cascade to **Department → Programme → Level → Semester (1/2)** (`listDepartments`/`listProgrammes`/`listLevels`; semester a `<select>` 1/2); the column help to `Course code, Course title, Credit Value, Course type`; a **Download template** button (`onClick={() => downloadCsvTemplate("courses-template.csv", COURSE_TEMPLATE_HEADERS)}`); `target()` returns `{ rows, programmeId, levelId, semesterRank: Number(semester), departmentId }`; `validate`/`commit` call `core.importCourses`; the report badges show `created`/`updated` instead of `imported`. Use accessible labels (`aria-label`) on selects, the file input, and the Download button.

- [ ] **Step 4: Add the nav route.** In `AppShell.tsx`: add `"importCourses"` to the `Route` union, a NAV entry `{ key: "importCourses", label: "Import courses", icon: <existing>, perm: "courses.create", group: "Records" }`, and a TITLES entry. In `App.tsx`: import `ImportCoursesScreen`, add `studentMaintenance`-style `: route === "importCourses" ? (<ImportCoursesScreen />)` branch, and a `SCREEN_NAMES.importCourses` entry.

- [ ] **Step 5: Run → PASS;** `npx tsc --noEmit` clean; full `npx vitest run` green.
- [ ] **Step 6: Commit.**

```bash
git add src/presentation/screens/ImportCoursesScreen.tsx src/presentation/components/AppShell.tsx src/presentation/App.tsx tests/ui/import-courses.test.tsx
git commit -m "feat(ui): import-courses screen + nav"
```

### Task 4.2: Retrofit the student import screen with a template button

**Files:**

- Modify: `src/presentation/screens/ImportStudentsScreen.tsx`
- Test: `tests/ui/import-students.test.tsx` (find/extend — if none, add a focused test)

- [ ] **Step 1: Write a failing test** asserting a "Download template" button is present on the student screen and clicking it triggers the template download (spy on `URL.createObjectURL` or the helper).

- [ ] **Step 2: Implement.** Import `downloadCsvTemplate, STUDENT_TEMPLATE_HEADERS` and add a **Download template** button near the file input: `onClick={() => downloadCsvTemplate("students-template.csv", STUDENT_TEMPLATE_HEADERS)}` with `aria-label="Download template"`.

- [ ] **Step 3: Run → PASS;** full suite green; tsc clean.
- [ ] **Step 4: Commit.**

```bash
git add src/presentation/screens/ImportStudentsScreen.tsx tests/ui/import-students.test.tsx
git commit -m "feat(ui): download-template button on student import"
```

---

## Phase 5 — Verify, docs & rebuild

### Task 5.1: Full verification

- [ ] **Step 1:** `npx tsc --noEmit` (clean); `npx eslint src tests --quiet` (clean); `npx prettier --check "src/**/*.{ts,tsx}" "tests/**/*.{ts,tsx}"` (clean — `--write` if not); `npx vitest run` (all green, count > pre-feature).
- [ ] **Step 2:** Architecture fitness (`tests/architecture.test.ts`) — `ImportCourses` stays framework-free of UI; `csvTemplate.ts`'s pure builder has no infra imports.

### Task 5.2: Docs

**Files:**

- Modify: `docs/superpowers/specs/2026-06-21-course-import-design.md` (Status → Implemented; tick §8 DoD)

- [ ] **Step 1:** Flip Status + tick the boxes. Commit `docs: mark course import implemented`.

### Task 5.3: Rebuild & reinstall

- [ ] **Step 1:** Build the **production** installer (the default build is the UAT auto-unlock variant, which cannot open a real production DB): `npm run tauri -- build -- --no-default-features`. Expect the MSI/EXE bundles written (the `TAURI_SIGNING_PRIVATE_KEY` updater step exits non-zero AFTER the installers are produced; artifacts are valid).
- [ ] **Step 2:** Clean reinstall (per-user; clear `%LOCALAPPDATA%\EARTMP`, run the NSIS setup `/S`) and relaunch; unlock with the operator passphrase; smoke test: open **Import courses**, download the template, fill 2 rows, validate (a bad type blocks commit), commit, and confirm created/updated counts; re-upload with one changed credit to confirm the upsert updates.

---

## Self-review notes (coverage map)

- **Spec §3 use-case (upsert/report/alias/dry-run/all-or-nothing)** → Tasks 0.1, 0.2.
- **Spec §4 template helper** → Task 2.1.
- **Spec §5 UI (course screen + student retrofit + nav)** → Tasks 4.1, 4.2.
- **Spec §6 parseWorkbook gating fix** → Task 1.1.
- **Spec §7 wiring + tests** → Task 3.1 + TDD throughout + Task 5.1.

**Type-consistency checks:** `CourseImportReport { totalRows, validRows, created, updated, errors }` is identical in the use-case (0.2), the contract (3.1), the harness default (3.1), and the UI (4.1); `ImportCoursesInput` fields match the contract input and the screen's `target()`; `COURSE_TEMPLATE_HEADERS`/`STUDENT_TEMPLATE_HEADERS` defined in 2.1 are consumed in 4.1/4.2; `COURSE_TYPES` exported in 0.1 is imported in 0.2.

**Flagged verify-points (not blockers):** exact `TransactionalRepos` field names for `courses`/`audit` (0.2); the host-dispatch test harness shape for the `parseWorkbook` test (1.1); whether an `import-students.test.tsx` already exists to extend (4.2); the nav `icon` value to reuse for the new entry (4.1).
