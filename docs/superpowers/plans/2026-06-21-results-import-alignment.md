# Results Import Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the results import to full UX parity with the student/course imports — column aliases, optional `sitting`/`status` columns (bulk resit + DID), a dynamic downloadable template, and inline column-help.

**Architecture:** Extend the existing `ImportResults` application use-case (parsing/validation/write inside one `uow.run`) and the `ImportScreen` presentation component in place. Reuse the `ResultSitting` domain value-object (`assertSitting`/`assertStatus`) and the client-side `downloadCsvTemplate` helper. No new files, no contract/host/zod changes (the `ResultRepository` already accepts `status` and a nullable `finalScore`; `getAssessmentStructure` is already on the contract).

**Tech Stack:** TypeScript (strict), Vitest + React Testing Library, Clean Architecture (domain/application/presentation).

**Spec:** `docs/superpowers/specs/2026-06-21-results-import-alignment-design.md`

---

## Context for the implementer (read before starting)

**The use-case today** (`src/application/use-cases/results/ImportResults.ts`): inside `uow.run`, it loops rows, reads `row.matricNumber`/`row.courseCode` (exact keys only), resolves student/course, checks in-file dups on `${matric}::${code}`, validates a component score for **every** assessment component, computes `finalScore`, looks up an existing **NORMAL** row (hard-coded) to upsert, and on a clean batch writes via `repos.results.create({ ..., sitting: "NORMAL", status: "GRADED" })` or `repos.results.updateScores(id, { componentScores, finalScore })`. Report = `ImportReport { totalRows, validRows, imported, errors }`.

**Domain value-object** (`src/domain/value-objects/ResultSitting.ts`, already exists):

```ts
export const RESULT_SITTINGS = ["NORMAL", "RESIT"] as const;
export type ResultSitting = (typeof RESULT_SITTINGS)[number];
export const RESULT_STATUSES = [
  "GRADED",
  "DID",
  "DISQUALIFIED",
  "INCOMPLETE",
] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];
export function assertSitting(v: string): asserts v is ResultSitting; // throws `Unknown result sitting "X".`
export function assertStatus(v: string): asserts v is ResultStatus; // throws `Unknown result status "X".`
```

**Repository (already supports what we need)** — `src/domain/repositories/records.ts`:

```ts
create(data: Omit<ResultRecord, "id">): Promise<ResultRecord>;   // ResultRecord: finalScore?: number; sitting: ResultSitting; status: ResultStatus; isLocked: boolean
updateScores(id, data: { componentScores: {key;score}[]; finalScore?: number | null; status?: ResultStatus }): Promise<void>;
findByStudentAndSemester(studentId, semesterId): Promise<ResultRecord[]>; // all sittings
```

**Contract (already present)** — `getAssessmentStructure(input: Record<string, never>): Promise<AssessmentComponent[]>` where `AssessmentComponent = { key, label, weight, maxScore }`.

**Template helper (already present)** — `src/presentation/screens/import/csvTemplate.ts` exports `downloadCsvTemplate(filename, headers)`.

**Test infrastructure:** use-case tests live in `tests/results/import-results.test.ts` (fakes: `FakeStudentRepo`, `FakeCourseRepo`, `FakeResultRepo`, `fakeUow`, `GradingConfigService` with a 2-component default `ca`/`exam`). UI tests live in `tests/ui/import.test.tsx` (`renderScreen` harness; `makeCore` default `getAssessmentStructure: async () => []`).

**Run commands:** single file `npx vitest run <path>`; full suite `npx vitest run`; types `npx tsc --noEmit`. The pre-commit hook auto-runs eslint+prettier. End every commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

**Branch discipline:** work directly on `feat/eartmp-phases-0-5`. Do NOT create or switch to a git worktree. After each commit run `git log --oneline -1` and confirm it landed on HEAD.

---

## File Structure

- **Modify** `src/application/use-cases/results/ImportResults.ts` — aliases; parse+validate optional `sitting`/`status`; non-graded rows skip score validation/compute and store no `finalScore`; sitting-aware dedupe + existing-row lookup; create/update carry `sitting`+`status` (Task 1).
- **Modify** `tests/results/import-results.test.ts` — new cases for aliases, sitting/status, non-graded, invalid values, RESIT-distinct (Task 1).
- **Modify** `src/presentation/screens/ImportScreen.tsx` — Download-template button (dynamic headers from `getAssessmentStructure` incl. `sitting`/`status`) + inline column-help (Task 2).
- **Modify** `tests/ui/import.test.tsx` — template button + column-help cases (Task 2).

---

## Task 1: `ImportResults` — aliases, optional sitting/status, sitting-aware upsert

**Files:**

- Modify: `src/application/use-cases/results/ImportResults.ts`
- Test: `tests/results/import-results.test.ts`

- [ ] **Step 1: Write the failing tests**

Append these cases inside the `describe("ImportResults", ...)` block in `tests/results/import-results.test.ts` (the `setup()`/`admin`/`SEM` helpers already exist):

```ts
it("accepts matric/code/'Course code' aliases", async () => {
  const report = await ctx.uc.execute(
    {
      semesterId: SEM,
      rows: [{ matric: "M/1", code: "CS101", ca: 28, exam: 65 }],
    },
    admin,
  );
  expect(report.imported).toBe(1);
  expect(report.errors).toHaveLength(0);
  expect(ctx.results.rows[0]!.finalScore).toBe(93);
});

it("imports a RESIT row as a separate row from the NORMAL one", async () => {
  await ctx.results.create({
    studentId: "st1",
    courseId: "co1",
    semesterId: SEM,
    componentScores: [],
    finalScore: 40,
    isLocked: false,
    sitting: "NORMAL",
    status: "GRADED",
  });
  const report = await ctx.uc.execute(
    {
      semesterId: SEM,
      rows: [
        {
          matricNumber: "M/1",
          courseCode: "CS101",
          ca: 30,
          exam: 70,
          sitting: "RESIT",
        },
      ],
    },
    admin,
  );
  expect(report.imported).toBe(1);
  expect(ctx.results.rows).toHaveLength(2); // NORMAL untouched + new RESIT
  const normal = ctx.results.rows.find((r) => r.sitting === "NORMAL")!;
  expect(normal.finalScore).toBe(40);
  const resit = ctx.results.rows.find((r) => r.sitting === "RESIT")!;
  expect(resit.finalScore).toBe(100);
});

it("imports a DID row with no scores and stores no finalScore", async () => {
  const report = await ctx.uc.execute(
    {
      semesterId: SEM,
      rows: [{ matricNumber: "M/1", courseCode: "CS101", status: "DID" }],
    },
    admin,
  );
  expect(report.imported).toBe(1);
  expect(report.errors).toHaveLength(0);
  const row = ctx.results.rows[0]!;
  expect(row.status).toBe("DID");
  expect(row.finalScore).toBeUndefined();
});

it("flags an unknown sitting or status value", async () => {
  const report = await ctx.uc.execute(
    {
      semesterId: SEM,
      rows: [
        {
          matricNumber: "M/1",
          courseCode: "CS101",
          ca: 1,
          exam: 1,
          sitting: "EXTRA",
        },
        {
          matricNumber: "M/2",
          courseCode: "CS101",
          ca: 1,
          exam: 1,
          status: "BOGUS",
        },
      ],
    },
    admin,
  );
  expect(report.imported).toBe(0);
  expect(report.errors.find((e) => e.row === 1)!.messages.join()).toMatch(
    /Unknown result sitting/,
  );
  expect(report.errors.find((e) => e.row === 2)!.messages.join()).toMatch(
    /Unknown result status/,
  );
});

it("a non-graded status update clears the finalScore on the existing row", async () => {
  await ctx.results.create({
    studentId: "st1",
    courseId: "co1",
    semesterId: SEM,
    componentScores: [{ key: "ca", score: 20 }],
    finalScore: 50,
    isLocked: false,
    sitting: "NORMAL",
    status: "GRADED",
  });
  const report = await ctx.uc.execute(
    {
      semesterId: SEM,
      rows: [
        { matricNumber: "M/1", courseCode: "CS101", status: "INCOMPLETE" },
      ],
    },
    admin,
  );
  expect(report.imported).toBe(1);
  expect(ctx.results.rows).toHaveLength(1); // updated in place
  const row = ctx.results.rows[0]!;
  expect(row.status).toBe("INCOMPLETE");
  expect(row.finalScore == null).toBe(true); // null or undefined
});
```

> Note: the `FakeResultRepo.updateScores` must apply `status` and a `null` `finalScore`. If the fake ignores those fields, update it minimally so the last two tests can pass — check `tests/results/fakes.ts` and make `updateScores` assign `componentScores`, `finalScore` (when the key is present, including `null`), and `status` (when present) onto the stored row. Do this as part of Step 3 only if a test reveals the gap.

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run tests/results/import-results.test.ts`
Expected: the 5 new tests FAIL — aliases unread (`Unknown student ""`), `sitting`/`status` columns ignored (RESIT collides/overwrites, DID demands scores, bad values not flagged). Existing tests still pass.

- [ ] **Step 3: Replace the use-case body**

Replace the entire contents of `src/application/use-cases/results/ImportResults.ts` with:

```ts
/**
 * ImportResults — bulk-import results from already-parsed spreadsheet rows
 * (Phase 10). Validates every row (student/course resolve, scores in range, no
 * in-file duplicates, target not locked), builds a per-row report, and — only
 * when every row is valid and it is not a dry run — commits the whole batch in
 * one transaction (all-or-nothing, AD10.2/F-1). Reuses the Phase 9 scoring path
 * so import and manual entry agree (AD10.3). Optional `sitting` (NORMAL/RESIT)
 * and `status` (GRADED/DID/DISQUALIFIED/INCOMPLETE) columns let a batch carry
 * resits and non-graded outcomes; non-graded rows need no scores. Permission-
 * gated + audited. Import is authoritative — it does NOT enforce resit
 * eligibility.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import {
  assertSitting,
  assertStatus,
  type ResultSitting,
  type ResultStatus,
} from "../../../domain/value-objects/ResultSitting";
import type { RawRow } from "../../ports/SpreadsheetReaderPort";
import type { GradingConfigService } from "../../services/GradingConfigService";
import type { UnitOfWork } from "../../ports/UnitOfWork";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

export interface RowError {
  row: number; // 1-based data-row number
  messages: string[];
}

export interface ImportReport {
  totalRows: number;
  validRows: number;
  imported: number;
  errors: RowError[];
}

export interface ImportResultsInput {
  semesterId: string;
  rows: RawRow[];
  dryRun?: boolean;
}

interface ValidEntry {
  studentId: string;
  courseId: string;
  componentScores: { key: string; score: number }[];
  finalScore?: number;
  sitting: ResultSitting;
  status: ResultStatus;
  existingId?: string;
}

export class ImportResults implements AuthorizedUseCase<
  ImportResultsInput,
  ImportReport
> {
  readonly name = "ImportResults";
  readonly requiredPermissions = ["results.import"];

  constructor(
    private readonly grading: GradingConfigService,
    private readonly uow: UnitOfWork,
  ) {}

  async execute(
    input: ImportResultsInput,
    session: SessionContext,
  ): Promise<ImportReport> {
    const structure = await this.grading.loadAssessmentStructure();
    const components = structure.toComponents();

    // Validation and the commit run in ONE transaction so the lock-check and
    // existing-result lookup see the same snapshot the writes commit against —
    // no TOCTOU window where a concurrent import locks or creates a row between
    // "valid" and "written" (AD10.2/F-1). A dry run takes the same read path and
    // simply writes nothing.
    return this.uow.run(async (repos) => {
      const seen = new Set<string>();
      const errors: RowError[] = [];
      const valid: ValidEntry[] = [];

      for (let i = 0; i < input.rows.length; i++) {
        const row = input.rows[i]!;
        const messages: string[] = [];
        // Accept the camelCase keys AND the friendly header aliases, matching
        // the student/course imports.
        const matric = String(
          row.matricNumber ?? row.matric ?? row.matricNo ?? "",
        ).trim();
        const code = String(
          row.courseCode ?? row.code ?? row["Course code"] ?? "",
        ).trim();
        if (!matric) messages.push("Missing matricNumber.");
        if (!code) messages.push("Missing courseCode.");

        const student = matric
          ? await repos.students.findByMatric(matric)
          : null;
        if (matric && !student) messages.push(`Unknown student "${matric}".`);
        const course = code ? await repos.courses.findByCode(code) : null;
        if (code && !course) messages.push(`Unknown course "${code}".`);

        // Optional sitting / status (default NORMAL / GRADED), validated against
        // the value-object's allowed set. A blank cell keeps the default.
        const sittingRaw =
          String(row.sitting ?? row.Sitting ?? "")
            .trim()
            .toUpperCase() || "NORMAL";
        const statusRaw =
          String(row.status ?? row.Status ?? "")
            .trim()
            .toUpperCase() || "GRADED";
        let sitting: ResultSitting = "NORMAL";
        let status: ResultStatus = "GRADED";
        try {
          assertSitting(sittingRaw);
          sitting = sittingRaw;
        } catch (e) {
          messages.push((e as Error).message);
        }
        try {
          assertStatus(statusRaw);
          status = statusRaw;
        } catch (e) {
          messages.push((e as Error).message);
        }
        const graded = status === "GRADED";

        // Dedupe key is sitting-aware so a RESIT row never collides with the
        // student's NORMAL row.
        if (matric && code) {
          const key = `${matric}::${code}::${sitting}`;
          if (seen.has(key))
            messages.push("Duplicate row for this student/course.");
          else seen.add(key);
        }

        // Build + validate component scores ONLY for graded rows; a
        // DID/DISQUALIFIED/INCOMPLETE row carries no scores.
        const componentScores = graded
          ? components.map((c) => ({ key: c.key, score: Number(row[c.key]) }))
          : [];
        if (graded) {
          for (const c of components) {
            const v = row[c.key];
            if (v === undefined || v === "" || Number.isNaN(Number(v))) {
              messages.push(`Missing/invalid score for "${c.key}".`);
            }
          }
        }

        let finalScore: number | undefined;
        if (graded && messages.length === 0) {
          try {
            finalScore = structure.computeFinalScore(componentScores);
          } catch (e) {
            messages.push((e as Error).message);
          }
        }

        let existingId: string | undefined;
        if (messages.length === 0 && student && course) {
          const existing = (
            await repos.results.findByStudentAndSemester(
              student.id,
              input.semesterId,
            )
          ).find((r) => r.courseId === course.id && r.sitting === sitting);
          if (existing?.isLocked) {
            messages.push(
              "Existing result is locked; unlock before importing.",
            );
          } else {
            existingId = existing?.id;
          }
        }

        if (messages.length > 0) {
          errors.push({ row: i + 1, messages });
        } else {
          valid.push({
            studentId: student!.id,
            courseId: course!.id,
            componentScores,
            ...(finalScore !== undefined ? { finalScore } : {}),
            sitting,
            status,
            ...(existingId ? { existingId } : {}),
          });
        }
      }

      const base: ImportReport = {
        totalRows: input.rows.length,
        validRows: valid.length,
        imported: 0,
        errors,
      };

      if (input.dryRun || errors.length > 0) return base;

      for (const v of valid) {
        const graded = v.status === "GRADED";
        if (v.existingId) {
          await repos.results.updateScores(v.existingId, {
            componentScores: v.componentScores,
            finalScore: graded ? v.finalScore! : null,
            status: v.status,
          });
        } else {
          await repos.results.create({
            studentId: v.studentId,
            courseId: v.courseId,
            semesterId: input.semesterId,
            componentScores: v.componentScores,
            ...(graded ? { finalScore: v.finalScore! } : {}),
            isLocked: false,
            sitting: v.sitting,
            status: v.status,
          });
        }
      }
      await repos.audit.record({
        userId: session.actorId,
        action: "IMPORT",
        entity: "Result",
        recordId: input.semesterId,
        newValue: { imported: valid.length },
      });

      return { ...base, imported: valid.length };
    });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/results/import-results.test.ts`
Expected: PASS — all pre-existing tests plus the 5 new ones. (If the two upsert/non-graded tests fail because the fake drops `status`/`null finalScore`, apply the minimal `tests/results/fakes.ts` fix noted in Step 1, then re-run.)

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (expect no output).

```bash
git add src/application/use-cases/results/ImportResults.ts tests/results/import-results.test.ts tests/results/fakes.ts
git commit -m "feat(results): import accepts aliases + optional sitting/status (resit & DID)"
git log --oneline -1
```

Expected: commit on `feat/eartmp-phases-0-5` HEAD.

---

## Task 2: `ImportScreen` — dynamic template + column-help

**Files:**

- Modify: `src/presentation/screens/ImportScreen.tsx`
- Test: `tests/ui/import.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append inside the `describe("ImportScreen", ...)` block in `tests/ui/import.test.tsx`:

```ts
  it("download template button present (dynamic component headers)", async () => {
    const createObjectURL = vi.fn(() => "blob:test");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    renderScreen(<ImportScreen />, {
      permissions: ["results.import"],
      core: {
        ...baseCore,
        getAssessmentStructure: async () => [
          { key: "ca", label: "CA", weight: 30, maxScore: 30 },
          { key: "exam", label: "Exam", weight: 70, maxScore: 70 },
        ],
      },
    });
    const btn = await screen.findByRole("button", {
      name: /download template/i,
    });
    btn.click(); // must not throw
    expect(createObjectURL).toHaveBeenCalled();
  });

  it("shows inline column help including sitting and status", async () => {
    renderScreen(<ImportScreen />, {
      permissions: ["results.import"],
      core: { ...baseCore },
    });
    expect(await screen.findByText(/sitting/i)).toBeInTheDocument();
    expect(screen.getByText(/status/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/ui/import.test.tsx`
Expected: both new tests FAIL — no "Download template" button, no column-help text. Existing ImportScreen tests pass.

- [ ] **Step 3: Add the import + structure fetch**

In `src/presentation/screens/ImportScreen.tsx`, extend the existing `csvTemplate` usage. Add this import near the other imports (after the `ui` import block):

```ts
import { downloadCsvTemplate } from "./import/csvTemplate";
```

Inside the `ImportScreen` component body, alongside the existing `sessions`/`semesters` `useAsync` calls, add:

```ts
const structure = useAsync(() => core.getAssessmentStructure({}), []);
const templateHeaders = [
  "matricNumber",
  "courseCode",
  ...(structure.data ?? []).map((c) => c.key),
  "sitting",
  "status",
];
```

- [ ] **Step 4: Add the Download-template button to the file Field**

In the `Card title="1 · Target & file"` block, replace the existing `<Field label="Spreadsheet (.xlsx / .csv)">…</Field>` (the file input) with this version that wraps the input + a button (mirrors `ImportStudentsScreen`):

```tsx
<Field label="Spreadsheet (.xlsx / .csv)">
  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
    <input
      className="input"
      type="file"
      accept=".xlsx,.csv"
      aria-label="Spreadsheet file"
      onChange={(e) => onFile(e.target.files?.[0])}
    />
    <Button
      variant="ghost"
      aria-label="Download template"
      onClick={() =>
        downloadCsvTemplate("results-template.csv", templateHeaders)
      }
    >
      Download template
    </Button>
  </div>
</Field>
```

- [ ] **Step 5: Add the inline column-help**

Immediately after the `{rows && ( … rows parsed … )}` block inside the same Card (before the Card closes), add:

```tsx
<div className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>
  Columns: <span className="mono">matricNumber</span>,{" "}
  <span className="mono">courseCode</span>, and one column per assessment
  component (e.g. <span className="mono">ca</span>,{" "}
  <span className="mono">exam</span>) — required for graded rows. Optional:{" "}
  <span className="mono">sitting</span> (NORMAL/RESIT, default NORMAL) and{" "}
  <span className="mono">status</span> (GRADED/DID/DISQUALIFIED/INCOMPLETE,
  default GRADED). Non-graded rows need no scores.
</div>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/ui/import.test.tsx`
Expected: PASS — both new tests plus the existing ones.

- [ ] **Step 7: Typecheck + commit**

Run: `npx tsc --noEmit` (expect no output).

```bash
git add src/presentation/screens/ImportScreen.tsx tests/ui/import.test.tsx
git commit -m "feat(ui): results import gains a dynamic template download + column help"
git log --oneline -1
```

---

## Task 3: Full-suite verification + docs

**Files:**

- Modify: `docs/superpowers/specs/2026-06-21-results-import-alignment-design.md` (tick the DoD boxes)

- [ ] **Step 1: Run the whole suite + static gates**

Run: `npx vitest run` (expect all green), `npx tsc --noEmit` (clean), `npx eslint src tests --quiet` (clean).
Expected: no regressions; boundary fitness (`tests/architecture.test.ts`) unaffected.

- [ ] **Step 2: Tick the DoD checkboxes in the spec**

In `docs/superpowers/specs/2026-06-21-results-import-alignment-design.md` §5, change each `- [ ]` to `- [x]` and set the header `**Status:**` to `Implemented (2026-06-21)`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-21-results-import-alignment-design.md
git commit -m "docs: mark results-import alignment implemented"
git log --oneline -1
```

---

## Self-review notes (author)

- **Spec coverage:** aliases (T1 S3), optional sitting/status validated (T1 S1/S3), non-graded skip-scores + no finalScore (T1), sitting-aware dedupe+lookup (T1), create/update carry sitting+status incl. clear-on-non-graded (T1), locked-row block retained (existing test), no resit-eligibility (no eligibility code added), dynamic template + column-help (T2), report shape & `results.import` gating unchanged (no edits to either). All covered.
- **Type consistency:** `ResultSitting`/`ResultStatus` imported from the value-object; `updateScores` `finalScore?: number | null` + `status?` and `create`'s `Omit<ResultRecord,"id">` already match the repo port; `AssessmentComponent.key` used for headers.
- **No placeholders:** all steps carry full code + exact run commands.
- **Out of scope (unchanged):** created/updated split, resit-eligibility, programme/level scope, `.xlsx` template.
