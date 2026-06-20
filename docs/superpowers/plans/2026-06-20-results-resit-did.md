# Results Entry, Resit Sessions & DID — Implementation Plan (Workstream B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add resit/carryover attempts, DID and extra result statuses, a
course-roster batch entry grid with enrollment-history rosters, dual-entry
transcripts with a re-attempt asterisk, sitting-level locking, and a
`results.override` admin capability — building on the existing EARTMP results
pipeline.

**Architecture:** Approach A from the spec — `Result` gains `sitting` +
`status` columns and a relaxed unique key; effective-attempt selection becomes a
pure domain function keyed per-course across the whole record; the GPA engine,
processing, transcript and a new batch use-case consume it. Faculty scoping from
Workstream A is reused. Clean Architecture boundaries are preserved (domain has
no Prisma/React; UI calls use-cases via the core).

**Tech Stack:** TypeScript (strict), Prisma + SQLite/libSQL, Vitest, React 19 +
Tauri, Zod (host input validation).

**Spec:** `docs/superpowers/specs/2026-06-20-results-resit-did-design.md`

**Conventions used throughout:**

- Run a single test file: `npx vitest run tests/<path> -t "<name>"`.
- Run the suite: `npx vitest run`.
- Typecheck: `npx tsc --noEmit`. Lint: `npx eslint src tests --quiet`.
- Commit messages end with the project's `Co-Authored-By` trailer.
- A concrete, already-merged model for every mechanical infra/wiring task is the
  **Workstream A** change set (commit `6b33b24`): the `UserFaculty` migration
  folder, `ensureBuiltinRoles` in seed, and the `setUserFaculties`
  contract/ipc/inputSchemas/composition wiring. Open those files when a task says
  "mirror the Workstream A pattern" — they are the canonical example.

---

## Phase 0 — Schema, migration & domain types

### Task 0.1: Add `sitting`/`status` to the Prisma schema + relaxed unique key

**Files:**

- Modify: `prisma/schema.prisma:386-415` (the `Result` model)

- [ ] **Step 1: Edit the `Result` model.** Add the two columns and change the
      unique key. Replace the field block + `@@unique` line so the model reads:

```prisma
model Result {
  id                 String    @id @default(cuid())
  studentId          String
  student            Student   @relation(fields: [studentId], references: [id])
  courseId           String
  course             Course    @relation(fields: [courseId], references: [id])
  semesterId         String
  semester           Semester  @relation(fields: [semesterId], references: [id])
  componentScores    String // JSON: [{key,score}]
  finalScore         Float?
  grade              String?
  gradePoint         Float?
  creditsEarned      Int?
  sitting            String    @default("NORMAL") // NORMAL | RESIT
  status             String    @default("GRADED") // GRADED | DID | DISQUALIFIED | INCOMPLETE
  gradeScaleId       String?
  assessmentConfigId String?
  isLocked           Boolean   @default(false)
  version            Int       @default(0)
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  deletedAt          DateTime?

  @@unique([studentId, courseId, semesterId, sitting])
  @@index([studentId, semesterId])
  @@index([studentId])
  @@index([courseId, semesterId])
  @@index([deletedAt])
}
```

- [ ] **Step 2: Regenerate the Prisma client.**

Run: `npm run db:generate`
Expected: "Generated Prisma Client" with no errors.

- [ ] **Step 3: Commit.**

```bash
git add prisma/schema.prisma
git commit -m "feat(results): add sitting/status to Result + sitting in unique key"
```

### Task 0.2: Hand-author the migration

**Files:**

- Create: `prisma/migrations/20260620120000_result_sitting_status/migration.sql`

- [ ] **Step 1: Write the migration SQL.** SQLite cannot add a column to a
      UNIQUE-bearing table and re-key in place cleanly, but it CAN add columns and
      rebuild only the index. Add the two columns with defaults (so existing rows
      stay valid), then drop and recreate the unique index to include `sitting`:

```sql
-- Workstream B: resit/carryover sittings + result statuses.
ALTER TABLE "Result" ADD COLUMN "sitting" TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "Result" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'GRADED';

-- Re-key uniqueness to include the sitting so NORMAL + RESIT can coexist.
DROP INDEX IF EXISTS "Result_studentId_courseId_semesterId_key";
CREATE UNIQUE INDEX "Result_studentId_courseId_semesterId_sitting_key"
  ON "Result"("studentId", "courseId", "semesterId", "sitting");
```

- [ ] **Step 2: Confirm the old index name.** Open the prior Result migration to
      confirm the auto-generated unique-index name matches the `DROP INDEX` above.

Run: `npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` (sanity: empty diff means schema and migrations agree after deploy)
Expected: after Step 3 the diff is empty.

- [ ] **Step 3: Apply to the dev DB.**

Run: `npx prisma migrate deploy`
Expected: "1 migration applied" (the new folder) with no error.

- [ ] **Step 4: Verify the runtime migration runner picks it up.** The runner
      applies bundled migrations on launch (it discovered `20260619120000_user_faculty`
      the same way). Open `src/infrastructure/db/` migration-runner source and confirm
      migrations are auto-discovered from the folder (no manifest to edit). If a
      manifest/array of migration ids exists, append `20260620120000_result_sitting_status`.

Run: `npx vitest run tests/migrations -t "upgrade"`
Expected: PASS (existing upgrade-path test still green; extended in Task 0.3).

- [ ] **Step 5: Commit.**

```bash
git add prisma/migrations/20260620120000_result_sitting_status/migration.sql
git commit -m "feat(results): migration adds sitting/status columns + re-keyed unique index"
```

### Task 0.3: Extend the migration upgrade-path test

**Files:**

- Modify: `tests/migrations/` (the existing runtime-migration upgrade test — find with `grep -rl "PRAGMA table_info" tests/migrations`)

- [ ] **Step 1: Add assertions** that after running migrations on a pre-B
      database, `Result` has the new columns and the new unique index. Use the
      established `PRAGMA table_info` approach (double-quoted identifiers are string
      literals in SQLite, so column presence MUST be checked via PRAGMA, never a
      `SELECT "col"`):

```ts
it("adds sitting/status columns and re-keys Result uniqueness", async () => {
  // ... run the migration runner against the seeded pre-B db (as the existing test does) ...
  const cols = await db.all(`PRAGMA table_info("Result")`);
  const names = cols.map((c: { name: string }) => c.name);
  expect(names).toContain("sitting");
  expect(names).toContain("status");

  const idx = await db.all(`PRAGMA index_list("Result")`);
  expect(
    idx.some(
      (i: { name: string }) =>
        i.name === "Result_studentId_courseId_semesterId_sitting_key",
    ),
  ).toBe(true);
});
```

- [ ] **Step 2: Run it.**

Run: `npx vitest run tests/migrations`
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add tests/migrations
git commit -m "test(migrations): assert Result sitting/status columns + new unique index"
```

### Task 0.4: Sitting & status value-objects (domain guards)

**Files:**

- Create: `src/domain/value-objects/ResultSitting.ts`
- Test: `tests/domain/result-sitting.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from "vitest";
import {
  RESULT_SITTINGS,
  RESULT_STATUSES,
  assertSitting,
  assertStatus,
  countsAsFail,
  isPending,
} from "../../src/domain/value-objects/ResultSitting";

describe("ResultSitting / ResultStatus", () => {
  it("enumerates the allowed values", () => {
    expect([...RESULT_SITTINGS]).toEqual(["NORMAL", "RESIT"]);
    expect([...RESULT_STATUSES]).toEqual([
      "GRADED",
      "DID",
      "DISQUALIFIED",
      "INCOMPLETE",
    ]);
  });

  it("assertSitting/assertStatus reject unknown values", () => {
    expect(() => assertSitting("RESIT")).not.toThrow();
    expect(() => assertSitting("EXTRA")).toThrow(/sitting/i);
    expect(() => assertStatus("DID")).not.toThrow();
    expect(() => assertStatus("NOPE")).toThrow(/status/i);
  });

  it("classifies statuses for GPA", () => {
    // DID and DISQUALIFIED count as an F; INCOMPLETE is pending (excluded).
    expect(countsAsFail("DID")).toBe(true);
    expect(countsAsFail("DISQUALIFIED")).toBe(true);
    expect(countsAsFail("GRADED")).toBe(false);
    expect(isPending("INCOMPLETE")).toBe(true);
    expect(isPending("GRADED")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — expect failure** (`Cannot find module`).

Run: `npx vitest run tests/domain/result-sitting.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.**

```ts
/**
 * Result sitting + status value-objects. Sittings distinguish the normal exam
 * from the semester's resit; statuses classify a row for GPA/transcript. Stored
 * as strings on Result (Approach A); guarded here so the allowed set has one
 * source of truth.
 */
export const RESULT_SITTINGS = ["NORMAL", "RESIT"] as const;
export type ResultSitting = (typeof RESULT_SITTINGS)[number];

export const RESULT_STATUSES = [
  "GRADED",
  "DID",
  "DISQUALIFIED",
  "INCOMPLETE",
] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

export function assertSitting(v: string): asserts v is ResultSitting {
  if (!(RESULT_SITTINGS as readonly string[]).includes(v)) {
    throw new Error(`Unknown result sitting "${v}".`);
  }
}

export function assertStatus(v: string): asserts v is ResultStatus {
  if (!(RESULT_STATUSES as readonly string[]).includes(v)) {
    throw new Error(`Unknown result status "${v}".`);
  }
}

/** DID and DISQUALIFIED are scored as an F (attempted, 0 points). */
export function countsAsFail(status: ResultStatus): boolean {
  return status === "DID" || status === "DISQUALIFIED";
}

/** INCOMPLETE is pending — excluded from GPA until resolved. */
export function isPending(status: ResultStatus): boolean {
  return status === "INCOMPLETE";
}
```

- [ ] **Step 4: Run it — expect PASS.**

Run: `npx vitest run tests/domain/result-sitting.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/domain/value-objects/ResultSitting.ts tests/domain/result-sitting.test.ts
git commit -m "feat(domain): ResultSitting/ResultStatus value-objects"
```

### Task 0.5: Extend the `ResultRecord` entity

**Files:**

- Modify: `src/domain/entities/index.ts:51-62`

- [ ] **Step 1: Add the two fields** to `ResultRecord` (import the types):

```ts
import type {
  ResultSitting,
  ResultStatus,
} from "../value-objects/ResultSitting";

export interface ResultRecord {
  id: string;
  studentId: string;
  courseId: string;
  semesterId: string;
  componentScores: { key: string; score: number }[];
  finalScore?: number;
  grade?: string;
  gradePoint?: number;
  creditsEarned?: number;
  isLocked: boolean;
  sitting: ResultSitting;
  status: ResultStatus;
}
```

- [ ] **Step 2: Typecheck — expect failures** in every place that constructs a
      `ResultRecord` (fakes, Prisma mapper, EnterResult.create). These are fixed in
      later tasks; record the list now.

Run: `npx tsc --noEmit`
Expected: errors listing each construction site (e.g. `tests/.../fakes.ts`,
`PrismaRecordsRepositories.ts`, `ManageResults.ts`). Note them for Tasks 1.x.

- [ ] **Step 3: Commit** (the entity change alone; downstream fixed next).

```bash
git add src/domain/entities/index.ts
git commit -m "feat(domain): ResultRecord carries sitting + status"
```

---

## Phase 1 — Repository: sitting-aware reads/writes

### Task 1.1: Extend the `ResultRepository` port

**Files:**

- Modify: `src/domain/repositories/records.ts:78-120`

- [ ] **Step 1: Update the port.** `findByStudentAndSemester` already returns all
      rows for a semester (now multiple sittings). Add a `sitting` arg to `existsFor`,
      let `updateScores`/`updateProcessed` carry `status`, and keep `findByStudent`
      (it returns the whole record — used for global selection). Replace the interface:

```ts
import type {
  ResultSitting,
  ResultStatus,
} from "../value-objects/ResultSitting";

export interface ResultRepository {
  create(data: Omit<ResultRecord, "id">): Promise<ResultRecord>;
  findById(id: string): Promise<ResultRecord | null>;
  /** True if a live row exists for this (student, course, semester, sitting). */
  existsFor(
    studentId: string,
    courseId: string,
    semesterId: string,
    sitting: ResultSitting,
  ): Promise<boolean>;
  /** All live rows (every sitting) for a student's semester. */
  findByStudentAndSemester(
    studentId: string,
    semesterId: string,
  ): Promise<ResultRecord[]>;
  /** The student's ENTIRE live result set (all sessions) — global selection. */
  findByStudent(studentId: string): Promise<ResultRecord[]>;
  updateScores(
    id: string,
    data: {
      componentScores: { key: string; score: number }[];
      finalScore?: number;
      status?: ResultStatus;
    },
  ): Promise<void>;
  updateProcessed(
    id: string,
    data: {
      grade: string;
      gradePoint: number;
      creditsEarned: number;
      finalScore?: number;
      gradeScaleId?: string;
    },
  ): Promise<void>;
  setLockedForSemester(
    studentId: string,
    semesterId: string,
    locked: boolean,
    sitting?: ResultSitting,
  ): Promise<number>;
  unlock(id: string): Promise<void>;
}
```

- [ ] **Step 2: Typecheck** to list the impl/fakes needing updates.

Run: `npx tsc --noEmit`
Expected: errors in `PrismaRecordsRepositories.ts` and any fakes.

- [ ] **Step 3: Commit.**

```bash
git add src/domain/repositories/records.ts
git commit -m "feat(domain): ResultRepository is sitting/status aware"
```

### Task 1.2: Update the Prisma `ResultRepository` implementation

**Files:**

- Modify: `src/infrastructure/repositories/PrismaRecordsRepositories.ts` (the `PrismaResultRepository` class — find with `grep -n "class PrismaResultRepository" src/infrastructure/repositories/PrismaRecordsRepositories.ts`)

- [ ] **Step 1: Map the new columns.** In the row→entity mapper add
      `sitting: row.sitting as ResultSitting` and `status: row.status as ResultStatus`.
      In `create`, persist `sitting: data.sitting` and `status: data.status`. Update
      `existsFor` to filter `sitting`. Update `setLockedForSemester` to add
      `...(sitting ? { sitting } : {})` to the `where`. Update `updateScores` to write
      `status` when provided. Keep all `where` clauses `deletedAt: null` (live rows).

Concrete mapper (match the file's existing style):

```ts
private toEntity(row: PrismaResultRow): ResultRecord {
  return {
    id: row.id,
    studentId: row.studentId,
    courseId: row.courseId,
    semesterId: row.semesterId,
    componentScores: JSON.parse(row.componentScores),
    ...(row.finalScore != null ? { finalScore: row.finalScore } : {}),
    ...(row.grade != null ? { grade: row.grade } : {}),
    ...(row.gradePoint != null ? { gradePoint: row.gradePoint } : {}),
    ...(row.creditsEarned != null ? { creditsEarned: row.creditsEarned } : {}),
    isLocked: row.isLocked,
    sitting: row.sitting as ResultSitting,
    status: row.status as ResultStatus,
  };
}
```

`create` body adds:

```ts
data: {
  studentId: data.studentId,
  courseId: data.courseId,
  semesterId: data.semesterId,
  componentScores: JSON.stringify(data.componentScores),
  finalScore: data.finalScore ?? null,
  isLocked: data.isLocked,
  sitting: data.sitting,
  status: data.status,
},
```

- [ ] **Step 2: Typecheck.**

Run: `npx tsc --noEmit`
Expected: `PrismaRecordsRepositories.ts` errors resolved (other call-sites pending).

- [ ] **Step 3: Commit.**

```bash
git add src/infrastructure/repositories/PrismaRecordsRepositories.ts
git commit -m "feat(infra): Prisma result repo maps sitting/status"
```

### Task 1.3: Update result repository fakes used in tests

**Files:**

- Modify: every in-memory result fake (find with `grep -rln "findByStudentAndSemester" tests`)

- [ ] **Step 1: Add `sitting`/`status` defaults** to each fake's stored rows and
      `create` (`sitting: data.sitting ?? "NORMAL"`, `status: data.status ?? "GRADED"`),
      add the `sitting` arg to `existsFor`/`setLockedForSemester`, and honor `status`
      in `updateScores`. Keep them minimal — only what the tests touch.

- [ ] **Step 2: Typecheck + run the existing results tests.**

Run: `npx tsc --noEmit && npx vitest run tests/results tests/integration`
Expected: PASS (existing behavior preserved; new fields default to NORMAL/GRADED).

- [ ] **Step 3: Commit.**

```bash
git add tests
git commit -m "test(results): fakes carry sitting/status"
```

---

## Phase 2 — Global effective-attempt selection (domain)

### Task 2.1: Attempt-ordering + effective-selection pure function

**Files:**

- Create: `src/domain/services/ResultAttempts.ts`
- Test: `tests/domain/result-attempts.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from "vitest";
import {
  orderAttempts,
  selectEffective,
  type Attempt,
} from "../../src/domain/services/ResultAttempts";

// helper: minimal attempt
const a = (over: Partial<Attempt>): Attempt => ({
  id: "x",
  courseId: "C",
  sessionOrder: 0,
  semesterRank: 1,
  sitting: "NORMAL",
  status: "GRADED",
  ...over,
});

describe("ResultAttempts", () => {
  it("orders by session, then semester rank, then NORMAL before RESIT", () => {
    const out = orderAttempts([
      a({ id: "resit", sitting: "RESIT" }),
      a({ id: "normal", sitting: "NORMAL" }),
      a({ id: "nextYear", sessionOrder: 1 }),
    ]);
    expect(out.map((x) => x.id)).toEqual(["normal", "resit", "nextYear"]);
  });

  it("per course, the latest attempt is effective; earlier ones discounted", () => {
    const sel = selectEffective([
      a({ id: "f", sitting: "NORMAL", status: "DID" }),
      a({ id: "c", sitting: "RESIT", status: "GRADED" }),
    ]);
    expect(sel.effectiveIds.has("c")).toBe(true);
    expect(sel.effectiveIds.has("f")).toBe(false);
    expect(sel.isReattempt("c")).toBe(true); // not the first attempt of C
    expect(sel.isReattempt("f")).toBe(false);
  });

  it("cross-session carryover: later-session retake is effective", () => {
    const sel = selectEffective([
      a({ id: "f", courseId: "M", sessionOrder: 0, status: "GRADED" }),
      a({ id: "b", courseId: "M", sessionOrder: 1, status: "GRADED" }),
    ]);
    expect(sel.effectiveIds.has("b")).toBe(true);
    expect(sel.isReattempt("b")).toBe(true);
  });

  it("an INCOMPLETE latest attempt makes the course pending (not effective for GPA)", () => {
    const sel = selectEffective([a({ id: "i", status: "INCOMPLETE" })]);
    expect(sel.effectiveIds.has("i")).toBe(false);
    expect(sel.pendingCourseIds.has("C")).toBe(true);
  });

  it("courses are independent", () => {
    const sel = selectEffective([
      a({ id: "c1", courseId: "A" }),
      a({ id: "c2", courseId: "B" }),
    ]);
    expect(sel.effectiveIds.has("c1")).toBe(true);
    expect(sel.effectiveIds.has("c2")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — expect failure.**

Run: `npx vitest run tests/domain/result-attempts.test.ts`
Expected: FAIL (`Cannot find module`).

- [ ] **Step 3: Implement.**

```ts
/**
 * Effective-attempt selection (Workstream B). Per courseId, attempts are ordered
 * by session, then semester rank, then sitting (NORMAL before RESIT); the LATEST
 * attempt is "effective" and counts toward GPA, every earlier attempt is
 * discounted (kept for the transcript). An INCOMPLETE latest attempt leaves the
 * course pending — excluded from GPA until resolved. Pure: no I/O.
 */
import type {
  ResultSitting,
  ResultStatus,
} from "../value-objects/ResultSitting";
import { isPending } from "../value-objects/ResultSitting";

export interface Attempt {
  id: string;
  courseId: string;
  sessionOrder: number; // chronological rank of the session (0 = earliest)
  semesterRank: number; // Semester.rank within the session
  sitting: ResultSitting;
  status: ResultStatus;
}

const SITTING_ORDER: Record<ResultSitting, number> = { NORMAL: 0, RESIT: 1 };

/** Total order: session, then semester rank, then NORMAL before RESIT. */
export function orderAttempts<T extends Attempt>(attempts: T[]): T[] {
  return [...attempts].sort(
    (x, y) =>
      x.sessionOrder - y.sessionOrder ||
      x.semesterRank - y.semesterRank ||
      SITTING_ORDER[x.sitting] - SITTING_ORDER[y.sitting],
  );
}

export interface EffectiveSelection {
  /** Ids of the attempts that count toward GPA (one per non-pending course). */
  effectiveIds: Set<string>;
  /** Courses whose latest attempt is INCOMPLETE (pending → excluded). */
  pendingCourseIds: Set<string>;
  /** True when an attempt is not the first chronological attempt of its course. */
  isReattempt(id: string): boolean;
}

export function selectEffective(attempts: Attempt[]): EffectiveSelection {
  const byCourse = new Map<string, Attempt[]>();
  for (const at of attempts) {
    const list = byCourse.get(at.courseId) ?? [];
    list.push(at);
    byCourse.set(at.courseId, list);
  }

  const effectiveIds = new Set<string>();
  const pendingCourseIds = new Set<string>();
  const reattemptIds = new Set<string>();

  for (const [courseId, list] of byCourse) {
    const ordered = orderAttempts(list);
    ordered.forEach((at, i) => {
      if (i > 0) reattemptIds.add(at.id);
    });
    const latest = ordered[ordered.length - 1]!;
    if (isPending(latest.status)) {
      pendingCourseIds.add(courseId);
    } else {
      effectiveIds.add(latest.id);
    }
  }

  return {
    effectiveIds,
    pendingCourseIds,
    isReattempt: (id) => reattemptIds.has(id),
  };
}
```

- [ ] **Step 4: Run it — expect PASS.**

Run: `npx vitest run tests/domain/result-attempts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/domain/services/ResultAttempts.ts tests/domain/result-attempts.test.ts
git commit -m "feat(domain): global effective-attempt selection (resit/carryover)"
```

### Task 2.2: A `SemesterOrdering` port (session/rank lookup)

The selection needs each semester's `(sessionOrder, rank)`. Add a small port plus
its Prisma impl so application code can build `Attempt`s.

**Files:**

- Modify: `src/domain/repositories/records.ts` (append the port)
- Modify: `src/infrastructure/repositories/PrismaRecordsRepositories.ts` (impl)
- Test: `tests/results/semester-ordering.test.ts`

- [ ] **Step 1: Add the port** to `records.ts`:

```ts
/** Resolves a semester's chronological position for attempt ordering (WS B). */
export interface SemesterOrdering {
  /** Map every given semesterId to its (sessionOrder, rank). Unknown → omitted. */
  order(
    semesterIds: string[],
  ): Promise<Map<string, { sessionOrder: number; rank: number }>>;
}
```

- [ ] **Step 2: Write the failing impl test** (drive the Prisma impl through a
      seeded in-memory libSQL db — mirror the existing repo tests' setup in
      `tests/results` / `tests/integration`; if those hit a real Prisma test db, reuse
      that harness):

```ts
it("orders semesters by session createdAt then rank", async () => {
  // seed: session S1 (older) rank 1,2 ; session S2 (newer) rank 1
  const ord = new PrismaSemesterOrdering(prisma);
  const m = await ord.order([sem11, sem12, sem21]);
  expect(m.get(sem11)).toEqual({ sessionOrder: 0, rank: 1 });
  expect(m.get(sem12)).toEqual({ sessionOrder: 0, rank: 2 });
  expect(m.get(sem21)).toEqual({ sessionOrder: 1, rank: 1 });
});
```

- [ ] **Step 3: Implement** `PrismaSemesterOrdering`. Load the referenced
      semesters with their session; rank sessions by `startDate ?? createdAt` ascending
      to get `sessionOrder`:

```ts
export class PrismaSemesterOrdering implements SemesterOrdering {
  constructor(private readonly prisma: PrismaClient) {}
  async order(semesterIds: string[]) {
    const sems = await this.prisma.semester.findMany({
      where: { id: { in: semesterIds }, deletedAt: null },
      include: { session: true },
    });
    const sessions = [
      ...new Map(sems.map((s) => [s.sessionId, s.session])).values(),
    ];
    sessions.sort(
      (a, b) =>
        (a.startDate ?? a.createdAt).getTime() -
        (b.startDate ?? b.createdAt).getTime(),
    );
    const sessionOrder = new Map(sessions.map((s, i) => [s.id, i]));
    const out = new Map<string, { sessionOrder: number; rank: number }>();
    for (const s of sems) {
      out.set(s.id, {
        sessionOrder: sessionOrder.get(s.sessionId) ?? 0,
        rank: s.rank,
      });
    }
    return out;
  }
}
```

- [ ] **Step 4: Run the test — expect PASS.**

Run: `npx vitest run tests/results/semester-ordering.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/domain/repositories/records.ts src/infrastructure/repositories/PrismaRecordsRepositories.ts tests/results/semester-ordering.test.ts
git commit -m "feat: SemesterOrdering port + Prisma impl for attempt ordering"
```

---

## Phase 3 — Processing & sitting-level locking

### Task 3.1: `ProcessSemesterResults` — stamp all rows, GPA from effective set

**Files:**

- Modify: `src/application/use-cases/ProcessSemesterResults.ts`
- Modify: `src/application/ports/UnitOfWork.ts` (add `semesterOrdering` to the repos bundle — find the repos type)
- Test: `tests/results/process-semester.test.ts` (extend)

- [ ] **Step 1: Write failing tests** for the new behavior:

```ts
it("stamps both sittings but counts only the resit in GPA", async () => {
  // NORMAL DID (F) + RESIT 70 (C) for the same course/semester, credit 3.
  const summary = await process({ studentId: "s", semesterId: "sem" });
  // GPA reflects the resit's gradePoint only; credit counted once.
  expect(summary.creditsAttempted).toBe(3);
  expect(summary.gpa).toBeCloseTo(/* resit point */, 2);
  // both rows were stamped (grade set) for the transcript:
  expect(stamped.map((s) => s.id).sort()).toEqual(["normal", "resit"].sort());
});

it("does not mutate a locked row; recomputes only unlocked ones", async () => {
  // NORMAL locked (already graded), RESIT unlocked.
  await process({ studentId: "s", semesterId: "sem" });
  expect(updateProcessed).not.toHaveBeenCalledWith("normalLocked", expect.anything());
  expect(updateProcessed).toHaveBeenCalledWith("resit", expect.anything());
});

it("excludes an INCOMPLETE course from GPA", async () => {
  const summary = await process({ studentId: "s", semesterId: "sem" });
  expect(summary.creditsAttempted).toBe(0); // only course was INCOMPLETE
});
```

- [ ] **Step 2: Run — expect failure.**

Run: `npx vitest run tests/results/process-semester.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rewrite `execute`.** The key changes: fetch the **whole record**
      for the student (for cross-session effective selection), build `Attempt`s via
      `SemesterOrdering`, stamp every non-locked row in the target semester (DID/DQ →
      F at score 0; INCOMPLETE → skip stamping), and compute the returned summary from
      the **effective** rows in the target semester only. Never throw on locked rows;
      skip them for writes but include their stored grade in selection.

```ts
import { selectEffective, type Attempt } from "../../domain/services/ResultAttempts";
import { countsAsFail, isPending } from "../../domain/value-objects/ResultSitting";

async execute(input: ProcessSemesterInput): Promise<GpaSummary> {
  const engine = new GpaEngine(input.scale);
  return this.uow.run(async (repos) => {
    const all = await repos.results.findByStudent(input.studentId);
    if (all.every((r) => r.semesterId !== input.semesterId)) {
      throw new Error(`No results for student ${input.studentId} in semester ${input.semesterId}.`);
    }
    const ord = await repos.semesterOrdering.order([
      ...new Set(all.map((r) => r.semesterId)),
    ]);
    const attempts: Attempt[] = all.map((r) => ({
      id: r.id,
      courseId: r.courseId,
      sessionOrder: ord.get(r.semesterId)?.sessionOrder ?? 0,
      semesterRank: ord.get(r.semesterId)?.rank ?? 0,
      sitting: r.sitting,
      status: r.status,
    }));
    const sel = selectEffective(attempts);

    // Stamp every UNLOCKED row in the target semester so the transcript can show
    // each attempt. DID/DISQUALIFIED → F (score 0); INCOMPLETE → leave unstamped.
    const semRows = all.filter((r) => r.semesterId === input.semesterId);
    const effectiveInSem: { creditValue: number; gradePoint: number; creditsEarned: number; courseCode: string; finalScore: number }[] = [];
    for (const r of semRows) {
      const course = await repos.courses.findById(r.courseId);
      if (!course) throw new Error(`Course ${r.courseId} not found for result ${r.id}.`);
      if (isPending(r.status)) continue; // pending: not stamped, not counted
      const score = countsAsFail(r.status) ? 0 : r.finalScore;
      if (score === undefined) throw new Error(`Result ${r.id} has no final score; import first.`);
      const processed = engine.processSemester([
        { courseCode: course.code, creditValue: course.creditValue, finalScore: score },
      ]).courses[0]!;
      if (!r.isLocked) {
        await repos.results.updateProcessed(r.id, {
          grade: processed.grade,
          gradePoint: processed.gradePoint,
          creditsEarned: processed.creditsEarned,
          finalScore: score,
          ...(input.gradeScaleId ? { gradeScaleId: input.gradeScaleId } : {}),
        });
      }
      if (sel.effectiveIds.has(r.id)) {
        effectiveInSem.push({ ...processed, courseCode: course.code, finalScore: score });
      }
    }

    const summary = engine.processSemester(
      effectiveInSem.map((e) => ({ courseCode: e.courseCode, creditValue: e.creditValue, finalScore: e.finalScore })),
    );

    await repos.audit.record({
      userId: input.userId,
      action: "PROCESS_SEMESTER",
      entity: "Result",
      recordId: input.studentId,
      newValue: { semesterId: input.semesterId, gpa: summary.gpa },
    });
    return summary;
  });
}
```

> Note: `engine.processSemester` is reused per-row to resolve grade/point; the
> final summary is built from the effective rows. This keeps the existing GPA math
> authoritative and avoids duplicating grade resolution.

- [ ] **Step 4: Add `semesterOrdering`** to the `UnitOfWork` repos bundle type and
      its Prisma construction (wire `PrismaSemesterOrdering`).

- [ ] **Step 5: Run — expect PASS.**

Run: `npx vitest run tests/results/process-semester.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/application tests/results/process-semester.test.ts
git commit -m "feat(results): process stamps all sittings, GPA from effective attempts"
```

### Task 3.2: Sitting-level lock + `ProcessSemester` plumbing

**Files:**

- Modify: `src/application/use-cases/results/ManageResults.ts` (`LockSemesterResults`)
- Modify: `src/application/use-cases/results/ProcessSemester.ts` (pass `sitting` through if present)
- Test: `tests/results/manage-results.test.ts` (extend)

- [ ] **Step 1: Write failing test** — locking a sitting only locks that sitting:

```ts
it("locks only the named sitting", async () => {
  await new LockSemesterResults(results, audit).execute(
    { studentId: "s", semesterId: "sem", sitting: "NORMAL" },
    session,
  );
  expect(results.setLockedForSemester).toHaveBeenCalledWith(
    "s",
    "sem",
    true,
    "NORMAL",
  );
});
```

- [ ] **Step 2: Run — expect failure.**

Run: `npx vitest run tests/results/manage-results.test.ts -t "locks only"`
Expected: FAIL.

- [ ] **Step 3: Implement.** Add `sitting?: ResultSitting` to
      `LockSemesterResultsInput` and pass it through to `setLockedForSemester`; include
      it in the audit `newValue`.

```ts
export interface LockSemesterResultsInput {
  studentId: string;
  semesterId: string;
  sitting?: ResultSitting;
}
// ...
const count = await this.results.setLockedForSemester(
  input.studentId,
  input.semesterId,
  true,
  input.sitting,
);
```

- [ ] **Step 4: Run — expect PASS.**

Run: `npx vitest run tests/results/manage-results.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/application/use-cases/results tests/results/manage-results.test.ts
git commit -m "feat(results): sitting-level locking"
```

---

## Phase 4 — Entry: status, sitting, override, batch & roster

### Task 4.1: An override-capability helper

**Files:**

- Create: `src/application/authorization/resultsOverride.ts`
- Test: `tests/auth/results-override.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from "vitest";
import { canOverrideResults } from "../../src/application/authorization/resultsOverride";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";

describe("canOverrideResults", () => {
  it("is true only when the session holds results.override", () => {
    const admin = SessionContext.create("a", "SUPER_ADMIN", [
      "results.override",
    ]);
    const officer = SessionContext.create("o", "FACULTY_OFFICER", [
      "results.process",
    ]);
    expect(canOverrideResults(admin)).toBe(true);
    expect(canOverrideResults(officer)).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect failure.** `npx vitest run tests/auth/results-override.test.ts` → FAIL.

- [ ] **Step 3: Implement.**

```ts
/**
 * Admin override (WS B §7): a session holding `results.override` may bypass the
 * academic-process restrictions (locks, resit/retake eligibility, roster
 * membership). Tenant isolation is never overridable. Every override path is
 * audited by its caller.
 */
import type { SessionContext } from "../../domain/value-objects/SessionContext";

export const RESULTS_OVERRIDE = "results.override";

export function canOverrideResults(session: SessionContext): boolean {
  return session.permissionList().includes(RESULTS_OVERRIDE);
}
```

> Confirm the getter name: `SessionContext` exposes permissions via
> `permissionList()` (see `dispatcher.ts` `toView`). If a `has(perm)` method
> exists, prefer it.

- [ ] **Step 4: Run — expect PASS.** Commit.

```bash
git add src/application/authorization/resultsOverride.ts tests/auth/results-override.test.ts
git commit -m "feat(auth): results.override capability helper"
```

### Task 4.2: `EnterResult` — sitting, status, lock-bypass on override

**Files:**

- Modify: `src/application/use-cases/results/ManageResults.ts` (`EnterResult`)
- Test: `tests/results/manage-results.test.ts` + `tests/auth/faculty-scope.test.ts` (the EnterResult guard block already exists there)

- [ ] **Step 1: Write failing tests.**

```ts
it("creates a RESIT row distinct from the NORMAL row", async () => {
  await enter({ studentId: "s", courseId: "c", semesterId: "sem", sitting: "RESIT", componentScores: [...] });
  expect(results.create).toHaveBeenCalledWith(expect.objectContaining({ sitting: "RESIT", status: "GRADED" }));
});

it("records a DID with no scores", async () => {
  await enter({ studentId: "s", courseId: "c", semesterId: "sem", status: "DID", componentScores: [] });
  expect(results.create).toHaveBeenCalledWith(expect.objectContaining({ status: "DID" }));
});

it("refuses a locked row without override", async () => {
  // existing locked NORMAL row
  await expect(enter({ ...lockedTarget }, officerSession)).rejects.toThrow(/locked/i);
});

it("allows editing a locked row WITH override (audited as override)", async () => {
  await enter({ ...lockedTarget }, adminOverrideSession);
  expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ newValue: expect.objectContaining({ override: true }) }));
});
```

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement.** Extend `EnterResultInput` with
      `sitting?: ResultSitting` (default `NORMAL`) and `status?: ResultStatus` (default
      `GRADED`). Dedupe now keys on `(course, sitting)`. When `status` is non-graded,
      skip score computation and store `finalScore: undefined`. On a locked existing
      row, allow the edit only when `canOverrideResults(session)` (and stamp
      `override: true` in the audit `newValue`); otherwise throw as today.

```ts
export interface EnterResultInput {
  studentId: string;
  courseId: string;
  semesterId: string;
  componentScores: { key: string; score: number }[];
  sitting?: ResultSitting;
  status?: ResultStatus;
}
// inside execute, after guardStudentScope:
const sitting = input.sitting ?? "NORMAL";
const status = input.status ?? "GRADED";
assertSitting(sitting);
assertStatus(status);

const graded = status === "GRADED";
const finalScore = graded
  ? (await this.grading.loadAssessmentStructure()).computeFinalScore(
      input.componentScores,
    )
  : undefined;

const existing = (
  await this.results.findByStudentAndSemester(input.studentId, input.semesterId)
).find((r) => r.courseId === input.courseId && r.sitting === sitting);

const override = canOverrideResults(session);
if (existing?.isLocked && !override) {
  throw new RecordsError(
    "This result is locked; unlock it before editing scores.",
  );
}

if (existing) {
  await this.results.updateScores(existing.id, {
    componentScores: input.componentScores,
    ...(finalScore !== undefined ? { finalScore } : {}),
    status,
  });
  await this.audit.record({
    userId: session.actorId,
    action: "UPDATE",
    entity: "Result",
    recordId: existing.id,
    newValue: {
      finalScore,
      status,
      ...(existing.isLocked && override ? { override: true } : {}),
    },
  });
  return {
    ...existing,
    componentScores: input.componentScores,
    ...(finalScore !== undefined ? { finalScore } : {}),
    status,
  };
}

const created = await this.results.create({
  studentId: input.studentId,
  courseId: input.courseId,
  semesterId: input.semesterId,
  componentScores: input.componentScores,
  ...(finalScore !== undefined ? { finalScore } : {}),
  isLocked: false,
  sitting,
  status,
});
```

- [ ] **Step 4: Run the results + faculty-scope tests — expect PASS.**

Run: `npx vitest run tests/results/manage-results.test.ts tests/auth/faculty-scope.test.ts`
Expected: PASS (the faculty-scope EnterResult fixtures need `sitting`/`status` on
their fake rows — update if tsc flags them).

- [ ] **Step 5: Commit.**

```bash
git add src/application/use-cases/results/ManageResults.ts tests
git commit -m "feat(results): EnterResult carries sitting/status + override lock-bypass"
```

### Task 4.3: Enrollment-history roster resolver

**Files:**

- Create: `src/application/use-cases/results/CourseRoster.ts`
- Test: `tests/results/course-roster.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from "vitest";
import { CourseRoster } from "../../src/application/use-cases/results/CourseRoster";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";

describe("CourseRoster", () => {
  const session = SessionContext.create("u", "REGISTRAR", ["results.read"]);
  it("rosters students enrolled in the course's programme/level AS OF the session", async () => {
    // students: s1 enrolled prog P/level L covering 2025/2026; s2 enrolled elsewhere
    const roster = new CourseRoster(students, enrollments, courses);
    const out = await roster.list(
      { courseId: "c", sessionName: "2025/2026" },
      session,
    );
    expect(out.map((s) => s.id)).toEqual(["s1"]);
  });

  it("falls back to current placement when a student has no enrollment row", async () => {
    const out = await roster.list(
      { courseId: "c", sessionName: "2025/2026" },
      session,
    );
    expect(out.map((s) => s.id)).toContain("legacyStudent");
  });
});
```

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement.** Resolve the course's `programmeId`/`levelId`, find
      students whose `StudentEnrollment` covers the session (`fromSession <=
sessionName <= toSession` or `isCurrent`) with matching programme/level; legacy
      fallback to `Student.programmeId`/`levelId`. Apply faculty scope via
      `scopeStudentWhere` (Workstream A). Concretely:

```ts
export interface CourseRosterInput {
  courseId: string;
  sessionName: string;
}
export class CourseRoster {
  constructor(
    private readonly students: StudentRepository,
    private readonly enrollments: StudentEnrollmentRepository,
    private readonly courses: CourseRepository,
  ) {}
  async list(
    input: CourseRosterInput,
    session: SessionContext,
  ): Promise<Student[]> {
    const course = await this.courses.findById(input.courseId);
    if (!course) throw new RecordsError("Course not found.");
    const where = scopeStudentWhere(
      {
        programmeId: course.programmeId,
        levelId: course.levelId,
        status: "ACTIVE",
      },
      session,
    );
    const page = await this.students.find({ where });
    const out: Student[] = [];
    for (const s of page.items) {
      const spans = await this.enrollments.listByStudent(s.id);
      if (spans.length === 0) {
        out.push(s);
        continue;
      } // legacy fallback
      const covering = spans.find(
        (e) =>
          e.programmeId === course.programmeId &&
          e.levelId === course.levelId &&
          (e.isCurrent ||
            (e.fromSession <= input.sessionName &&
              (!e.toSession || input.sessionName <= e.toSession))),
      );
      if (covering) out.push(s);
    }
    return out;
  }
}
```

> Session-name string comparison works because sessions are `"YYYY/YYYY"` and
> compare lexicographically in chronological order. If the project stores session
> ids rather than names on enrollment, resolve via the session repo first — check
> `StudentEnrollment.fromSession` sample data.

- [ ] **Step 4: Run — expect PASS.** Commit.

```bash
git add src/application/use-cases/results/CourseRoster.ts tests/results/course-roster.test.ts
git commit -m "feat(results): enrollment-history course roster resolver"
```

### Task 4.4: `SaveCourseResults` batch use-case

**Files:**

- Create: `src/application/use-cases/results/SaveCourseResults.ts`
- Test: `tests/results/save-course-results.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
it("upserts every row for a course+sitting atomically", async () => {
  const uc = new SaveCourseResults(uow, grading);
  const report = await uc.execute(
    {
      semesterId: "sem", courseId: "c", sitting: "NORMAL",
      rows: [
        { studentId: "s1", componentScores: [{ key: "ca", score: 20 }, { key: "exam", score: 50 }] },
        { studentId: "s2", status: "DID", componentScores: [] },
      ],
    },
    session,
  );
  expect(report.saved).toBe(2);
});

it("writes nothing when any row is invalid (all-or-nothing)", async () => {
  await expect(uc.execute({ ...withOneBadScore }, session)).rejects.toBeTruthy();
  expect(created).toHaveLength(0);
});

it("in RESIT mode requires an unresolved failing prior attempt (unless override)", async () => {
  await expect(
    uc.execute({ semesterId: "sem", courseId: "c", sitting: "RESIT", rows: [{ studentId: "passed", componentScores: [...] }] }, officer),
  ).rejects.toThrow(/eligible/i);
});
```

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement.** Loop rows inside `uow.run` (atomic). For each row,
      reuse `EnterResult`'s scoring path (call the grading structure; or instantiate
      `EnterResult` per row sharing the same repos) so logic is DRY. In RESIT mode,
      check eligibility via the student's prior attempts unless `canOverrideResults`.
      Return `{ saved, skipped, errors }`. Gate `requiredPermissions = ["results.process"]`.

```ts
export interface SaveCourseResultsRow {
  studentId: string;
  componentScores: { key: string; score: number }[];
  status?: ResultStatus;
}
export interface SaveCourseResultsInput {
  semesterId: string;
  courseId: string;
  sitting: ResultSitting;
  rows: SaveCourseResultsRow[];
}
export interface SaveCourseResultsReport {
  saved: number;
  skipped: number;
  errors: { studentId: string; message: string }[];
}

export class SaveCourseResults implements AuthorizedUseCase<
  SaveCourseResultsInput,
  SaveCourseResultsReport
> {
  readonly name = "SaveCourseResults";
  readonly requiredPermissions = ["results.process"];
  constructor(
    private readonly uow: UnitOfWork,
    private readonly grading: GradingConfigService,
  ) {}
  async execute(
    input: SaveCourseResultsInput,
    session: SessionContext,
  ): Promise<SaveCourseResultsReport> {
    assertSitting(input.sitting);
    const structure = await this.grading.loadAssessmentStructure();
    const override = canOverrideResults(session);
    return this.uow.run(async (repos) => {
      let saved = 0;
      for (const row of input.rows) {
        const status = row.status ?? "GRADED";
        assertStatus(status);
        // RESIT eligibility (unless override): student must have an unresolved fail for this course.
        if (input.sitting === "RESIT" && !override) {
          const prior = (
            await repos.results.findByStudent(row.studentId)
          ).filter((r) => r.courseId === input.courseId);
          const eligible = prior.some(
            (r) =>
              r.status === "DID" ||
              r.status === "DISQUALIFIED" ||
              (r.grade && !isPassGrade(r)),
          );
          if (!eligible)
            throw new RecordsError(
              `Student ${row.studentId} is not resit-eligible for this course.`,
            );
        }
        const finalScore =
          status === "GRADED"
            ? structure.computeFinalScore(row.componentScores)
            : undefined;
        const existing = (
          await repos.results.findByStudentAndSemester(
            row.studentId,
            input.semesterId,
          )
        ).find(
          (r) => r.courseId === input.courseId && r.sitting === input.sitting,
        );
        if (existing?.isLocked && !override)
          throw new RecordsError(
            `A locked result blocks student ${row.studentId}.`,
          );
        if (existing) {
          await repos.results.updateScores(existing.id, {
            componentScores: row.componentScores,
            ...(finalScore !== undefined ? { finalScore } : {}),
            status,
          });
        } else {
          await repos.results.create({
            studentId: row.studentId,
            courseId: input.courseId,
            semesterId: input.semesterId,
            componentScores: row.componentScores,
            ...(finalScore !== undefined ? { finalScore } : {}),
            isLocked: false,
            sitting: input.sitting,
            status,
          });
        }
        saved++;
      }
      await repos.audit.record({
        userId: session.actorId,
        action: "IMPORT",
        entity: "Result",
        recordId: input.courseId,
        newValue: {
          semesterId: input.semesterId,
          sitting: input.sitting,
          saved,
          ...(override ? { override: true } : {}),
        },
      });
      return { saved, skipped: 0, errors: [] };
    });
  }
}
```

> `isPassGrade(r)` — derive pass from the stored `gradePoint > 0` or a grade-scale
> lookup; simplest is "has a finalScore at/above the scale's pass mark." Implement
> as a tiny local using the loaded scale, or treat any `creditsEarned > 0` as pass.

- [ ] **Step 4: Run — expect PASS.** Commit.

```bash
git add src/application/use-cases/results/SaveCourseResults.ts tests/results/save-course-results.test.ts
git commit -m "feat(results): SaveCourseResults atomic batch + resit eligibility"
```

---

## Phase 5 — Seed the override permission & role

### Task 5.1: Seed `results.override` and grant it to SUPER_ADMIN

**Files:**

- Modify: `src/infrastructure/db/seed.ts` (permission list + SUPER_ADMIN role permissions)
- Test: `tests/auth/seed-roles.test.ts` (find the existing roles/permissions seed test)

- [ ] **Step 1: Write/extend the failing test** asserting the permission exists
      and SUPER_ADMIN has it:

```ts
it("seeds results.override on SUPER_ADMIN", async () => {
  await ensureBuiltinRoles(prisma);
  const perms = await rolePermissionKeysByName(prisma, "SUPER_ADMIN");
  expect(perms).toContain("results.override");
});
```

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement.** Add `results.override` to the permission catalogue and
      to the SUPER_ADMIN role's permission list in `seed.ts`. Because `ensureBuiltinRoles`
      is idempotent (Workstream A added it), existing DBs gain the permission on next
      launch. Do NOT add it to FACULTY_OFFICER.

- [ ] **Step 4: Run — expect PASS.** Commit.

```bash
git add src/infrastructure/db/seed.ts tests/auth/seed-roles.test.ts
git commit -m "feat(rbac): seed results.override permission on SUPER_ADMIN"
```

---

## Phase 6 — Transcript: dual entry, asterisk & markers

### Task 6.1: `ReportCourse` gains `afterReattempt` + `marker`; `ReportData` gains `legendNotes`

**Files:**

- Modify: `src/domain/services/TranscriptReportData.ts`

- [ ] **Step 1: Extend the types.**

```ts
export interface ReportCourse {
  code: string;
  title: string;
  creditValue: number;
  finalScore?: number;
  grade?: string;
  gradePoint?: number;
  creditsEarned?: number;
  afterReattempt?: boolean; // print grade with "*"
  marker?: "DQ" | "I"; // status marker
}

export interface ReportData {
  // ...existing fields...
  legendNotes?: string[]; // e.g. "* Mark obtained after Resit/Retake"
}
```

- [ ] **Step 2: Typecheck.** `npx tsc --noEmit` — expect only BuildReportData/renderer call-sites (next tasks).

- [ ] **Step 3: Commit.**

```bash
git add src/domain/services/TranscriptReportData.ts
git commit -m "feat(transcript): ReportCourse afterReattempt/marker + ReportData legendNotes"
```

### Task 6.2: `BuildReportData` — show every attempt, set markers, build legend, GPA from effective set

**Files:**

- Modify: `src/application/use-cases/transcripts/BuildReportData.ts`
- Modify: its constructor wiring (add `SemesterOrdering`) — caller in `src/host/composition.ts`
- Test: `tests/transcripts/build-report-data.test.ts` (find/create)

- [ ] **Step 1: Write failing tests.**

```ts
it("shows both attempts; resit grade flagged afterReattempt; legend added", async () => {
  // NORMAL F + RESIT C, same course/semester
  const data = await build.assemble("s", "TR-1", "2026-06-20");
  const courses = data.sessions.flatMap((x) => x.courses).filter((c) => c.code === "PHY101");
  expect(courses).toHaveLength(2);
  expect(courses.find((c) => c.grade === "C")?.afterReattempt).toBe(true);
  expect(data.legendNotes).toContain("Mark obtained after Resit/Retake");
});

it("discounts the original F from semester GPA and CGPA", async () => {
  const data = await build.assemble("s", "TR-1", "2026-06-20");
  // only the resit counts; credit once
  expect(data.summary.cgpa).toBeCloseTo(/* resit point */, 2);
});

it("a plain transcript (no reattempts/markers) has no legendNotes", async () => {
  const data = await build.assemble("plain", "TR-2", "2026-06-20");
  expect(data.legendNotes).toBeUndefined();
});
```

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement.** Fetch ALL results (not only `gradePoint !== undefined`)
      so every attempt shows; compute `selectEffective` over the whole record using
      `SemesterOrdering`; for each row build a `ReportCourse` (set `afterReattempt`
      from `sel.isReattempt(r.id)`; `marker` from status); for GPA items per semester,
      include ONLY rows in `sel.effectiveIds`. Build `legendNotes` from the markers
      actually present. Keep INCOMPLETE rows shown with `marker:"I"` and no points,
      excluded from GPA.

Key diffs to the existing loop (replace the `processed` filter and the per-row push):

```ts
const all = await this.results.findByStudent(studentId);
const ord = await this.semesterOrdering.order([
  ...new Set(all.map((r) => r.semesterId)),
]);
const sel = selectEffective(
  all.map((r) => ({
    id: r.id,
    courseId: r.courseId,
    sessionOrder: ord.get(r.semesterId)?.sessionOrder ?? 0,
    semesterRank: ord.get(r.semesterId)?.rank ?? 0,
    sitting: r.sitting,
    status: r.status,
  })),
);

const markersSeen = new Set<string>();
// ...in the per-row loop, for every row `r` (not just graded):
const isEffective = sel.effectiveIds.has(r.id);
const marker =
  r.status === "DISQUALIFIED"
    ? "DQ"
    : r.status === "INCOMPLETE"
      ? "I"
      : undefined;
const afterReattempt = sel.isReattempt(r.id);
if (afterReattempt) markersSeen.add("*");
if (marker) markersSeen.add(marker);
g.courses.push({
  code: course.code,
  title: course.title,
  creditValue: course.creditValue,
  ...(r.finalScore !== undefined ? { finalScore: r.finalScore } : {}),
  ...(r.grade !== undefined ? { grade: r.grade } : {}),
  ...(r.gradePoint !== undefined ? { gradePoint: r.gradePoint } : {}),
  ...(r.creditsEarned !== undefined ? { creditsEarned: r.creditsEarned } : {}),
  ...(afterReattempt ? { afterReattempt: true } : {}),
  ...(marker ? { marker } : {}),
});
if (isEffective && r.gradePoint !== undefined) {
  g.items.push({
    creditValue: course.creditValue,
    gradePoint: r.gradePoint,
    creditsEarned: r.creditsEarned ?? 0,
  });
}
```

After the sessions loop, build the legend:

```ts
const legendNotes: string[] = [];
if (markersSeen.has("*")) legendNotes.push("Mark obtained after Resit/Retake");
if (markersSeen.has("DQ")) legendNotes.push("Disqualified (malpractice)");
if (markersSeen.has("I")) legendNotes.push("Incomplete");
// include in the returned ReportData only when non-empty:
...(legendNotes.length ? { legendNotes } : {}),
```

- [ ] **Step 4: Add `SemesterOrdering`** to the `BuildReportData` constructor and
      wire `PrismaSemesterOrdering` at its construction site in `composition.ts`.

- [ ] **Step 5: Run — expect PASS.** Commit.

```bash
git add src/application/use-cases/transcripts/BuildReportData.ts src/host/composition.ts tests/transcripts/build-report-data.test.ts
git commit -m "feat(transcript): per-attempt rows, reattempt asterisk, status markers, legend"
```

### Task 6.3: Renderer — append `*`, render markers & legend

**Files:**

- Modify: the block-resolver that turns `ReportData` into `ResolvedDoc` (find with `grep -rln "courseTable" src` — likely `src/application/use-cases/transcripts/` or `src/infrastructure/`)
- Test: that resolver's test (extend)

- [ ] **Step 1: Write failing test** — a course row with `afterReattempt` renders
      its grade cell as `"C*"`; an `I` marker renders `"I"`; `legendNotes` appear as a
      `text` block beneath the course table/legend.

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement.** Where the course row builds its grade cell, use
      `course.afterReattempt ? \`${course.grade}_\` : course.grade`and substitute the`marker` for the grade when status is non-graded (`I`, or `F`+`DQ`footnote).
Emit each`legendNotes[i]`(prefixed with its symbol —`_`, `DQ`, `I`) as a
`text` block appended after the grade-scale legend.

- [ ] **Step 4: Run — expect PASS.** Commit.

```bash
git add src tests
git commit -m "feat(transcript): render reattempt asterisk, status markers & legend"
```

---

## Phase 7 — Host / contract / IPC / Zod wiring

### Task 7.1: Extend the CoreApi contract

**Files:**

- Modify: `src/presentation/runtime/contract.ts`

- [ ] **Step 1: Update method signatures.** Extend `enterResult` input with
      optional `sitting`/`status`; add `saveCourseResults(input): Promise<SaveCourseResultsReport>`;
      add `listCourseRoster(input): Promise<StudentSummary[]>`; extend
      `lockSemesterResults` input with optional `sitting`. Use the existing
      `SessionView`/result view types. Mirror the Workstream A `setUserFaculties`
      addition (commit `6b33b24`) for shape.

- [ ] **Step 2: Typecheck** to surface the mock/ipc/host gaps (fixed next steps).

- [ ] **Step 3: Commit.**

```bash
git add src/presentation/runtime/contract.ts
git commit -m "feat(contract): saveCourseResults, listCourseRoster, sitting params"
```

### Task 7.2: Zod input schemas

**Files:**

- Modify: `src/host/inputSchemas.ts`

- [ ] **Step 1: Add schemas** (mirror the existing `setUserFaculties` entry):

```ts
saveCourseResults: z.looseObject({
  semesterId: str,
  courseId: str,
  sitting: z.enum(["NORMAL", "RESIT"]),
  rows: z.array(
    z.looseObject({
      studentId: str,
      componentScores: z.array(z.looseObject({ key: str, score: z.number() })),
      status: z.enum(["GRADED", "DID", "DISQUALIFIED", "INCOMPLETE"]).optional(),
    }),
  ),
}),
listCourseRoster: z.looseObject({ courseId: str, sessionName: str }),
```

- [ ] **Step 2: Run host input tests** if present (`grep -rl inputSchemas tests`).

Run: `npx vitest run tests/host`
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add src/host/inputSchemas.ts
git commit -m "feat(host): zod schemas for saveCourseResults/listCourseRoster"
```

### Task 7.3: Register handlers in composition + ipcClient

**Files:**

- Modify: `src/host/composition.ts` (instantiate `SaveCourseResults`, `CourseRoster`; register registry thunks)
- Modify: `src/presentation/runtime/ipcClient.ts` (the in-process/Tauri client method map)
- Modify: `tests/ui/harness.tsx` (add `saveCourseResults`/`listCourseRoster` defaults to `makeCore`)

- [ ] **Step 1: Wire composition.** Construct the new use-cases with their repos
      (UoW, grading, students, enrollments, courses) and add registry entries:

```ts
saveCourseResults: (input, session) => authorize(saveCourseResults, input as never, session),
listCourseRoster: (input, session) => authorize(courseRosterUseCase, input as never, session),
```

> `CourseRoster` isn't currently an `AuthorizedUseCase`; either wrap it as one
> (`requiredPermissions = ["results.read"]`, `execute(input, session)`) or register
> it behind a thin authorized adapter. Prefer making it an `AuthorizedUseCase`.

- [ ] **Step 2: Wire ipcClient + harness defaults** (`saveCourseResults: async () => ({ saved: 0, skipped: 0, errors: [] })`, `listCourseRoster: async () => []`).

- [ ] **Step 3: Typecheck + run UI harness tests.**

Run: `npx tsc --noEmit && npx vitest run tests/ui`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add src/host/composition.ts src/presentation/runtime/ipcClient.ts tests/ui/harness.tsx
git commit -m "feat(host): register saveCourseResults + listCourseRoster"
```

---

## Phase 8 — UI: roster grid + per-student sitting selector

### Task 8.1: Per-student entry gains a sitting/status control

**Files:**

- Modify: `src/presentation/screens/ResultsScreen.tsx` (the `EntryModal`)
- Test: `tests/ui/results.test.tsx` (find/extend)

- [ ] **Step 1: Write failing test** — selecting "Resit" and saving calls
      `enterResult` with `sitting: "RESIT"`; choosing status "DID" disables the score
      inputs and sends `status: "DID"`.

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement.** Add a Sitting `<select>` (Normal/Resit) and a Status
      `<select>` to `EntryModal`; when status ≠ GRADED disable score fields; pass
      `sitting`/`status` to `core.enterResult`. Show a `*`/marker hint in the results
      table for non-NORMAL or non-GRADED rows.

- [ ] **Step 4: Run — expect PASS.** Commit.

```bash
git add src/presentation/screens/ResultsScreen.tsx tests/ui/results.test.tsx
git commit -m "feat(ui): per-student sitting/status entry"
```

### Task 8.2: Course-roster batch grid

**Files:**

- Create: `src/presentation/screens/CourseRosterGrid.tsx` (a mode/section of the Results screen)
- Modify: `src/presentation/screens/ResultsScreen.tsx` (mode toggle: Per-student ↔ Roster)
- Test: `tests/ui/course-roster-grid.test.tsx`

- [ ] **Step 1: Write failing tests.**

```ts
it("cascades Year→Semester→Department→Programme→Course→Sitting and loads the roster", async () => {
  // pick selectors, expect listCourseRoster called with { courseId, sessionName }
});
it("Save all calls saveCourseResults with the entered rows", async () => {
  // type scores for two students, click Save all
  expect(core.saveCourseResults).toHaveBeenCalledWith(
    expect.objectContaining({
      courseId: "c",
      sitting: "NORMAL",
      rows: expect.arrayContaining([
        expect.objectContaining({ studentId: "s1" }),
      ]),
    }),
  );
});
it("marking a student DID disables their score cells", async () => {
  /* ... */
});
it("resit mode requests the roster and shows only eligible students", async () => {
  /* ... */
});
it("faculty-scoped officer cannot widen beyond assigned faculties", async () => {
  // session.facultyIds = ["f1"]; department select only lists f1's departments
});
```

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement.** Cascading selects sourced from `listFaculties`/
      `listDepartments`/`listProgrammes`/`listCourses`/`listSessions`/`listSemesters`
      (already on the contract, faculty-scoped per Workstream A). Columns come from
      `getAssessmentStructure`. A per-row status control. "Save all" assembles `rows`
      and calls `saveCourseResults`; "Process & lock all" loops `processSemester` +
      `lockSemesterResults` per rostered student. Reuse existing form primitives
      (Button, Select) and the faculty-scope hint pattern from the Records screen.

- [ ] **Step 4: Run — expect PASS.** Commit.

```bash
git add src/presentation/screens/CourseRosterGrid.tsx src/presentation/screens/ResultsScreen.tsx tests/ui/course-roster-grid.test.tsx
git commit -m "feat(ui): course-roster batch entry grid"
```

---

## Phase 9 — Verification & docs

### Task 9.1: Full green + boundary fitness

- [ ] **Step 1: Typecheck, lint, format, full suite.**

Run:

```bash
npx tsc --noEmit
npx eslint src tests --quiet
npx prettier --check "src/**/*.{ts,tsx}" "tests/**/*.{ts,tsx}"
npx vitest run
```

Expected: all clean; suite fully green (count > the pre-B 490).

- [ ] **Step 2: Architecture fitness** — confirm the boundary test still passes
      (domain imports no Prisma/React). `ResultAttempts.ts`, `ResultSitting.ts`,
      `GpaEngine.ts` must stay framework-free.

Run: `npx vitest run -t "fitness"` (or the boundary test file)
Expected: PASS.

### Task 9.2: Update docs + mark spec done

**Files:**

- Modify: `docs/superpowers/specs/2026-06-20-results-resit-did-design.md` (flip Status to "Implemented"; tick the §9 DoD)
- Modify: `CLAUDE.md` "Current status" if it tracks workstreams

- [ ] **Step 1: Update the spec status + DoD checkboxes.**
- [ ] **Step 2: Commit.**

```bash
git add docs CLAUDE.md
git commit -m "docs: mark Workstream B implemented"
```

### Task 9.3: Rebuild & reinstall

- [ ] **Step 1: Build the installer.**

Run: `npm run tauri build`
Expected: exit 0; `EARTMP_*_x64_en-US.msi` produced. The new migration
auto-bundles via `tauri.conf.json` (`../prisma/migrations/` → `migrations/`) and
applies on first launch.

- [ ] **Step 2:** Reinstall from the MSI; smoke-test a resit entry end-to-end
      (enter NORMAL F → enter RESIT pass → process → generate transcript → confirm the
      `C*` dual entry + legend).

---

## Self-review notes (coverage map)

- **Spec §2 data model** → Tasks 0.1–0.5, 1.1–1.3.
- **Spec §3 global GPA rule** → Tasks 2.1, 2.2, 3.1.
- **Spec §4 transcript** → Tasks 6.1–6.3.
- **Spec §5 roster grid + per-student** → Tasks 4.3, 4.4, 8.1, 8.2.
- **Spec §6 processing & sitting-level locking** → Tasks 3.1, 3.2.
- **Spec §7 admin override** → Tasks 4.1, 4.2, 4.4, 5.1.
- **Spec §8 layering/testing** → TDD throughout + Task 9.1.
- **Spec §1.1 statuses** → Tasks 0.4 (VO), 3.1 (GPA), 6.2/6.3 (transcript), 8.x (UI).

**Type-consistency checks:** `ResultRecord.sitting/status` (0.5) match the VO types
(0.4) and the repo port (1.1); `Attempt` (2.1) is built identically in 3.1 and 6.2;
`SemesterOrdering.order(semesterIds[])` (2.2) is called with the same signature in
3.1 and 6.2; `afterReattempt`/`marker` (6.1) are produced in 6.2 and consumed in
6.3; `saveCourseResults`/`listCourseRoster` shapes (7.1/7.2) match the use-cases
(4.3/4.4) and UI calls (8.2).

**Open verification points flagged inline for the implementer** (not blockers):
the runtime migration-runner registration mechanism (0.2 step 4); the
`SessionContext` permission accessor name (4.1); whether `StudentEnrollment.fromSession`
stores a session name or id (4.3); the exact block-resolver file for the renderer (6.3).
