# Editable Grading System (Workstream D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make grade scales (bands), assessment structures (components), and standing/classification bands editable through the Configuration screen's Grading tab.

**Architecture:** The domain VOs (`GradeScale.create`, `AssessmentStructure.create`) and the `Create/Update/Delete` use-cases already exist and validate. This workstream (1) exposes the 6 create/update/delete use-cases across the contract/host/zod/ipc/harness seams through `authorize`, (2) closes a test gap on `UpdateGradeScale`/`UpdateAssessmentConfig`, and (3) builds inline editors with live validation mirroring the VOs and a forward-only safeguard. Standing bands ride the existing `getSetting`/`setSetting`. No schema, no migration, no domain changes.

**Tech Stack:** TypeScript (strict), Vitest, React 19 + Tauri, Zod.

**Spec:** `docs/superpowers/specs/2026-06-20-editable-grading-design.md`

**Conventions:**

- Test one file: `npx vitest run tests/<path>`. Full: `npx vitest run`. Typecheck: `npx tsc --noEmit`. Lint: `npx eslint src tests --quiet`.
- A lint-staged hook auto-runs prettier/eslint on commit. End commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Concrete model to mirror for wiring: the WS B `saveCourseResults`/`listCourseRoster` additions across `contract.ts` / `inputSchemas.ts` / `composition.ts` / `ipcClient.ts` / `tests/ui/harness.tsx`, and the already-wired `listGradeScales`/`setDefaultGradeScale` in those same files.

**Key existing facts (verified):**

- Use-cases in `src/application/use-cases/config/ManageGradeScales.ts` and `ManageAssessmentConfigs.ts`:
  - `CreateGradeScale({ name, bands: GradeBand[] }) → StoredGradeScale`, `UpdateGradeScale({ id, name?, bands? }) → StoredGradeScale`, `DeleteGradeScale({ id }) → void` (rejects deleting the default). Same trio for assessment configs with `components: AssessmentComponent[]`.
  - `GradeBand = { minMark, maxMark, grade, gradePoint, isPass }`; `AssessmentComponent = { key, label, weight, maxScore }`.
  - `StoredGradeScale = { id, name, bands: string /*JSON*/, isDefault }`; `StoredAssessmentConfig = { id, name, components: string /*JSON*/, isDefault }`.
- `composition.ts` already builds `gradeScales`/`assessmentConfigs` repos + `audit`, and constructs only `List*`/`SetDefault*` (NOT Create/Update/Delete). The registry already has `listGradeScales`/`setDefaultGradeScale`/`listAssessmentConfigs`/`setDefaultAssessmentConfig`.
- `ConfigurationScreen.tsx` `GradingTab` (~line 223) lists scales via `core.listGradeScales({})`, renders read-only `BandsTable({ bands: string })` (~line 731, `JSON.parse`) and `ComponentsTable({ components: string })` (~line 770). It also reads settings via `core.getSetting({ key })` (e.g. graduation requirements at ~line 302) and writes via `core.setSetting`.
- Standing bands: `SETTING_KEYS.standingBands = "grading.standingBands"`, value shape `{ label: string; minGpa: number }[]`.

---

## Phase 0 — Application test gap (Update use-cases)

### Task 0.1: Unit-test `UpdateGradeScale` and `UpdateAssessmentConfig`

**Files:**

- Modify/Create: `tests/config/manage-grade-scales.test.ts` (create if absent) and `tests/config/manage-assessment-configs.test.ts` (the latter exists — extend it)

- [ ] **Step 1: Confirm fakes.** Read `tests/config/manage-assessment-configs.test.ts` to reuse its in-memory `GradeScaleConfigRepository`/`AssessmentConfigRepository` fakes + `CapturingAudit`. If a grade-scale CRUD test file doesn't exist, mirror the assessment one.

- [ ] **Step 2: Write the failing tests.** For `UpdateGradeScale` (valid bands cover 0–100):

```ts
it("updates the name only, leaving bands intact", async () => {
  const repo = new FakeGradeScaleRepo([
    {
      id: "g1",
      name: "Old",
      bands: JSON.stringify(VALID_BANDS),
      isDefault: false,
    },
  ]);
  const out = await new UpdateGradeScale(repo, new CapturingAudit()).execute(
    { id: "g1", name: "New" },
    admin,
  );
  expect(out.name).toBe("New");
  expect(out.bands).toBe(JSON.stringify(VALID_BANDS));
});
it("updates the bands (re-validated + re-serialized)", async () => {
  const out = await new UpdateGradeScale(repo, new CapturingAudit()).execute(
    { id: "g1", bands: VALID_BANDS_2 },
    admin,
  );
  expect(JSON.parse(out.bands)).toEqual(VALID_BANDS_2);
});
it("rejects bands with a gap (GradeScaleError)", async () => {
  await expect(
    new UpdateGradeScale(repo, new CapturingAudit()).execute(
      { id: "g1", bands: BANDS_WITH_GAP },
      admin,
    ),
  ).rejects.toBeInstanceOf(GradeScaleError);
});
it("throws when the scale is missing", async () => {
  await expect(
    new UpdateGradeScale(
      new FakeGradeScaleRepo([]),
      new CapturingAudit(),
    ).execute({ id: "x", name: "y" }, admin),
  ).rejects.toThrow(/not found/i);
});
```

`VALID_BANDS` covers 0–100 (e.g. the seed's 5 bands). `BANDS_WITH_GAP` leaves a hole (e.g. 0–44 F then 50–100 A — missing 45–49). For `UpdateAssessmentConfig` add the analogue: name-only edit; components edit re-validated; weights-not-100 rejected (`AssessmentError`); missing-id throws. Import `GradeScaleError` from `../../src/domain/value-objects/GradeScale`, `AssessmentError` from `../../src/domain/value-objects/AssessmentStructure`, the use-cases from their `config/` modules, and a `SessionContext.create("a","SUPER_ADMIN",["config.manage"])` admin.

- [ ] **Step 3: Run → expect FAIL** only if the use-case were missing; since the use-cases already exist, these should PASS once written correctly. Run `npx vitest run tests/config/manage-grade-scales.test.ts tests/config/manage-assessment-configs.test.ts`. If a test fails because of a real behavior gap, that's a finding — report it; otherwise green confirms coverage.

- [ ] **Step 4: Commit.**

```bash
git add tests/config
git commit -m "test(config): cover UpdateGradeScale/UpdateAssessmentConfig"
```

---

## Phase 1 — Backend wiring (expose the 6 use-cases)

### Task 1.1: Contract methods

**Files:**

- Modify: `src/presentation/runtime/contract.ts` (near the existing `listGradeScales`/`setDefaultGradeScale`, ~lines 489–494)

- [ ] **Step 1: Add 6 method signatures** to the `CoreApi` interface (reuse imported `GradeBand`/`AssessmentComponent`/`StoredGradeScale`/`StoredAssessmentConfig`):

```ts
createGradeScale(input: { name: string; bands: GradeBand[] }): Promise<StoredGradeScale>;
updateGradeScale(input: { id: string; name?: string; bands?: GradeBand[] }): Promise<StoredGradeScale>;
deleteGradeScale(input: { id: string }): Promise<void>;
createAssessmentConfig(input: { name: string; components: AssessmentComponent[] }): Promise<StoredAssessmentConfig>;
updateAssessmentConfig(input: { id: string; name?: string; components?: AssessmentComponent[] }): Promise<StoredAssessmentConfig>;
deleteAssessmentConfig(input: { id: string }): Promise<void>;
```

- [ ] **Step 2: Typecheck** to surface the mock/ipc/host gaps (fixed in the next tasks): `npx tsc --noEmit` (expect errors in `harness.tsx`/`ipcClient.ts`/composition until wired).
- [ ] **Step 3: Commit.**

```bash
git add src/presentation/runtime/contract.ts
git commit -m "feat(contract): create/update/delete grade scale + assessment config"
```

### Task 1.2: Zod schemas

**Files:**

- Modify: `src/host/inputSchemas.ts`

- [ ] **Step 1: Add schemas** to the `SCHEMAS` map (`str = z.string()`; mirror the file's `z.looseObject`/`z.array` style):

```ts
createGradeScale: z.looseObject({ name: str, bands: z.array(z.looseObject({})) }),
updateGradeScale: z.looseObject({ id: str }),
deleteGradeScale: z.looseObject({ id: str }),
createAssessmentConfig: z.looseObject({ name: str, components: z.array(z.looseObject({})) }),
updateAssessmentConfig: z.looseObject({ id: str }),
deleteAssessmentConfig: z.looseObject({ id: str }),
```

(Band/component shape is fully validated by the domain VO in the use-case; the Zod guard only checks the envelope shape — keeping `bands`/`components` as arrays of objects is enough defense-in-depth.)

- [ ] **Step 2:** Run `npx vitest run tests/host` (if present) → PASS.
- [ ] **Step 3: Commit.**

```bash
git add src/host/inputSchemas.ts
git commit -m "feat(host): zod schemas for grade-scale/assessment CRUD"
```

### Task 1.3: Compose + register + ipcClient + harness

**Files:**

- Modify: `src/host/composition.ts`
- Modify: `src/presentation/runtime/ipcClient.ts`
- Modify: `tests/ui/harness.tsx`

- [ ] **Step 1: Import + construct the 6 use-cases** in `composition.ts`. Extend the existing imports from `ManageGradeScales`/`ManageAssessmentConfigs` to include `CreateGradeScale, UpdateGradeScale, DeleteGradeScale` and `CreateAssessmentConfig, UpdateAssessmentConfig, DeleteAssessmentConfig`. Near the existing `const listGradeScales = ...`:

```ts
const createGradeScale = new CreateGradeScale(gradeScales, audit);
const updateGradeScale = new UpdateGradeScale(gradeScales, audit);
const deleteGradeScale = new DeleteGradeScale(gradeScales, audit);
const createAssessmentConfig = new CreateAssessmentConfig(
  assessmentConfigs,
  audit,
);
const updateAssessmentConfig = new UpdateAssessmentConfig(
  assessmentConfigs,
  audit,
);
const deleteAssessmentConfig = new DeleteAssessmentConfig(
  assessmentConfigs,
  audit,
);
```

- [ ] **Step 2: Register registry thunks** beside the existing grading entries:

```ts
["createGradeScale", (i, s) => authorize(createGradeScale, i as never, s)],
["updateGradeScale", (i, s) => authorize(updateGradeScale, i as never, s)],
["deleteGradeScale", (i, s) => authorize(deleteGradeScale, i as never, s)],
["createAssessmentConfig", (i, s) => authorize(createAssessmentConfig, i as never, s)],
["updateAssessmentConfig", (i, s) => authorize(updateAssessmentConfig, i as never, s)],
["deleteAssessmentConfig", (i, s) => authorize(deleteAssessmentConfig, i as never, s)],
```

- [ ] **Step 3: ipcClient + harness.** Add the 6 forwarding methods in `ipcClient.ts` (mirror the sibling grading methods). Add `makeCore` defaults in `harness.tsx`:

```ts
createGradeScale: async () => ({}) as never,
updateGradeScale: async () => ({}) as never,
deleteGradeScale: async () => {},
createAssessmentConfig: async () => ({}) as never,
updateAssessmentConfig: async () => ({}) as never,
deleteAssessmentConfig: async () => {},
```

- [ ] **Step 4:** `npx tsc --noEmit` clean; `npx vitest run tests/ui tests/host` green.
- [ ] **Step 5: Commit.**

```bash
git add src/host/composition.ts src/presentation/runtime/ipcClient.ts tests/ui/harness.tsx
git commit -m "feat(host): register grade-scale/assessment CRUD methods"
```

---

## Phase 2 — Grade-scale editor (bands)

### Task 2.1: A reusable bands-validation helper

**Files:**

- Create: `src/presentation/screens/grading/bandsValidation.ts`
- Test: `tests/ui/bands-validation.test.ts`

- [ ] **Step 1: Failing test.** A pure helper the editor uses for live feedback (mirrors `GradeScale.create`; kept in presentation since it's UI-feedback-only — the use-case stays authoritative):

```ts
import {
  validateBands,
  type BandRow,
} from "../../src/presentation/screens/grading/bandsValidation";

const ok: BandRow[] = [
  { minMark: 0, maxMark: 44, grade: "F", gradePoint: 0, isPass: false },
  { minMark: 45, maxMark: 100, grade: "A", gradePoint: 4, isPass: true },
];
it("accepts a full 0-100 cover", () => expect(validateBands(ok)).toEqual([]));
it("flags a gap", () => {
  const gap = [{ ...ok[0], maxMark: 43 }, ok[1]];
  expect(validateBands(gap).join(" ")).toMatch(/gap|cover|45/i);
});
it("flags an overlap", () => {
  const ov = [{ ...ok[0], maxMark: 50 }, ok[1]];
  expect(validateBands(ov).join(" ")).toMatch(/overlap/i);
});
it("flags out-of-range + minMark>maxMark + negative point", () => {
  expect(
    validateBands([
      { minMark: 10, maxMark: 5, grade: "X", gradePoint: -1, isPass: false },
    ]).length,
  ).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `validateBands(rows): string[]` (empty array = valid). Sort by `minMark`; check each row `0 ≤ minMark ≤ maxMark ≤ 100`, `gradePoint ≥ 0`, `grade` non-empty; the first row starts at 0, the last ends at 100, and each next row's `minMark === prev.maxMark + 1` (contiguous integer bands — matches the seed convention 0–44/45–49/…). Return human-readable messages.

```ts
export interface BandRow {
  minMark: number;
  maxMark: number;
  grade: string;
  gradePoint: number;
  isPass: boolean;
}
export function validateBands(rows: BandRow[]): string[] {
  const errs: string[] = [];
  if (rows.length === 0) return ["Add at least one band."];
  rows.forEach((b, i) => {
    if (b.grade.trim() === "") errs.push(`Band ${i + 1}: grade is required.`);
    if (!(b.minMark >= 0 && b.maxMark <= 100))
      errs.push(`Band ${i + 1}: marks must be within 0–100.`);
    if (b.minMark > b.maxMark)
      errs.push(`Band ${i + 1}: min mark exceeds max mark.`);
    if (b.gradePoint < 0) errs.push(`Band ${i + 1}: grade point must be ≥ 0.`);
  });
  const sorted = [...rows].sort((a, b) => a.minMark - b.minMark);
  if (sorted[0]!.minMark !== 0) errs.push("Bands must start at 0.");
  if (sorted[sorted.length - 1]!.maxMark !== 100)
    errs.push("Bands must cover up to 100.");
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!,
      cur = sorted[i]!;
    if (cur.minMark <= prev.maxMark)
      errs.push(`Bands overlap around ${cur.minMark}.`);
    else if (cur.minMark !== prev.maxMark + 1)
      errs.push(`Gap between bands at ${prev.maxMark + 1}.`);
  }
  return errs;
}
```

- [ ] **Step 4: Run → PASS;** tsc clean. Commit.

```bash
git add src/presentation/screens/grading/bandsValidation.ts tests/ui/bands-validation.test.ts
git commit -m "feat(ui): grade-band live-validation helper"
```

### Task 2.2: Grade-scale editor modal + New/Edit/Delete wiring

**Files:**

- Modify: `src/presentation/screens/ConfigurationScreen.tsx` (the `GradingTab` + `BandsTable` area)
- Test: `tests/ui/grading-editor.test.tsx`

- [ ] **Step 1: Failing tests.**

```ts
it("creates a grade scale from the bands editor", async () => {
  const createGradeScale = vi.fn(async () => ({}) as never);
  const { user } = renderScreen(<ConfigurationScreen />, { permissions: ["config.read","config.manage"], core: { listGradeScales: async () => [], createGradeScale } });
  await user.click(await screen.findByRole("button", { name: /grading/i })); // select the tab if needed
  await user.click(await screen.findByRole("button", { name: /new scale/i }));
  await user.type(screen.getByLabelText(/scale name/i), "My Scale");
  // a default editor row exists; fill a valid single band 0-100
  // ... set minMark 0, maxMark 100, grade A, gradePoint 4 ...
  await user.click(screen.getByRole("button", { name: /^save$/i }));
  await waitFor(() => expect(createGradeScale).toHaveBeenCalledWith(expect.objectContaining({ name: "My Scale", bands: expect.any(Array) })));
});
it("disables Save while bands have a gap", async () => { /* edit to create a gap; Save disabled + error shown */ });
it("disables Delete for the default scale", async () => {
  renderScreen(<ConfigurationScreen />, { permissions: ["config.read","config.manage"], core: { listGradeScales: async () => [{ id:"g1", name:"Default", bands: JSON.stringify([{minMark:0,maxMark:100,grade:"A",gradePoint:4,isPass:true}]), isDefault: true }] } });
  expect(await screen.findByRole("button", { name: /delete/i })).toBeDisabled();
});
it("hides New/Edit/Delete without config.manage", async () => {
  renderScreen(<ConfigurationScreen />, { permissions: ["config.read"], core: { listGradeScales: async () => [{ id:"g1", name:"D", bands:"[]", isDefault:true }] } });
  expect(screen.queryByRole("button", { name: /new scale/i })).toBeNull();
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** a `GradeScaleEditorModal` in/near `GradingTab`: a name input + an editable rows table (each row: number inputs for minMark/maxMark/gradePoint, text for grade, checkbox for isPass, a remove button) + "Add band" (new row defaults `minMark = lastMaxMark + 1`, `maxMark = 100`). Show `validateBands(rows)` errors live; disable Save while non-empty. On Save, call `createGradeScale({ name, bands: rows })` or `updateGradeScale({ id, name, bands: rows })`; surface a server error (e.g. duplicate name) inline. Add "New scale" (top of the section), per-scale "Edit" (parse `JSON.parse(scale.bands)` into rows) and "Delete" (calls `deleteGradeScale`, disabled when `scale.isDefault`). Gate all three buttons behind the screen's existing `config.manage` permission check (the same mechanism that gates set-default — find how `GradingTab` knows permissions; if it doesn't, read the session via the existing `useCore`/session hook used elsewhere in the file). Refresh the list (`scales.reload()` / re-run `useAsync`) after a successful mutation. Add the forward-only note text in the modal: "Changes apply to future processing only — already-processed results keep their original grades."

- [ ] **Step 4: Run → PASS;** full `npx vitest run` green; tsc clean. Commit.

```bash
git add src/presentation/screens/ConfigurationScreen.tsx tests/ui/grading-editor.test.tsx
git commit -m "feat(ui): grade-scale bands editor (create/edit/delete)"
```

---

## Phase 3 — Assessment-structure editor (components)

### Task 3.1: Components-validation helper

**Files:**

- Create: `src/presentation/screens/grading/componentsValidation.ts`
- Test: `tests/ui/components-validation.test.ts`

- [ ] **Step 1: Failing test.**

```ts
import {
  validateComponents,
  weightTotal,
  type ComponentRow,
} from "../../src/presentation/screens/grading/componentsValidation";
const ok: ComponentRow[] = [
  { key: "ca", label: "CA", weight: 30, maxScore: 30 },
  { key: "exam", label: "Exam", weight: 70, maxScore: 70 },
];
it("accepts weights summing to 100", () =>
  expect(validateComponents(ok)).toEqual([]));
it("reports the weight total", () => expect(weightTotal(ok)).toBe(100));
it("flags weights not summing to 100", () =>
  expect(
    validateComponents([{ ...ok[0], weight: 40 }, ok[1]]).join(" "),
  ).toMatch(/100/));
it("flags duplicate keys + non-positive maxScore", () => {
  expect(
    validateComponents([
      { key: "a", label: "A", weight: 50, maxScore: 0 },
      { key: "a", label: "B", weight: 50, maxScore: 10 },
    ]).length,
  ).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `weightTotal(rows)` and `validateComponents(rows): string[]`: non-empty; keys non-empty + unique; each `0 ≤ weight ≤ 100`; `maxScore > 0`; `Math.abs(total - 100) < 1e-6` (mirrors `AssessmentStructure.create`).

- [ ] **Step 4: Run → PASS;** tsc clean. Commit.

```bash
git add src/presentation/screens/grading/componentsValidation.ts tests/ui/components-validation.test.ts
git commit -m "feat(ui): assessment-component live-validation helper"
```

### Task 3.2: Assessment-structure editor modal

**Files:**

- Modify: `src/presentation/screens/ConfigurationScreen.tsx` (the `ComponentsTable` area)
- Test: `tests/ui/grading-editor.test.tsx` (extend)

- [ ] **Step 1: Failing tests.**

```ts
it("creates an assessment config; Save gated on weights=100", async () => {
  const createAssessmentConfig = vi.fn(async () => ({}) as never);
  const { user } = renderScreen(<ConfigurationScreen />, { permissions: ["config.read","config.manage"], core: { listAssessmentConfigs: async () => [], createAssessmentConfig } });
  // open "New structure", add ca(30/30)+exam(70/70), Save
  await waitFor(() => expect(createAssessmentConfig).toHaveBeenCalledWith(expect.objectContaining({ name: expect.any(String), components: expect.any(Array) })));
});
it("shows the running weight total and blocks Save at !=100", async () => { /* total 90 → Save disabled, total shown */ });
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `AssessmentEditorModal`: name input + editable components rows (key/label/weight/maxScore + remove), "Add component", a visible "Total weight: N%" indicator, `validateComponents` errors live, Save disabled unless valid. Save → `createAssessmentConfig`/`updateAssessmentConfig`. New/Edit/Delete buttons gated by `config.manage`; Delete disabled for the default; refresh list after mutation; forward-only note in the modal.

- [ ] **Step 4: Run → PASS;** full suite green; tsc clean. Commit.

```bash
git add src/presentation/screens/ConfigurationScreen.tsx tests/ui/grading-editor.test.tsx
git commit -m "feat(ui): assessment-structure components editor (create/edit/delete)"
```

---

## Phase 4 — Standing-bands editor

### Task 4.1: Standing-bands editor in the Grading tab

**Files:**

- Modify: `src/presentation/screens/ConfigurationScreen.tsx` (add a Standing-bands section to `GradingTab`)
- Test: `tests/ui/grading-editor.test.tsx` (extend)

- [ ] **Step 1: Failing tests.**

```ts
it("loads + saves standing bands via settings", async () => {
  const setSetting = vi.fn(async () => {});
  const { user } = renderScreen(<ConfigurationScreen />, {
    permissions: ["config.read","config.manage"],
    core: {
      getSetting: async ({ key }: { key: string }) => key === "grading.standingBands" ? [{ label: "Pass", minGpa: 1 }] : ({} as never),
      setSetting,
    },
  });
  // edit the label / add a band, click Save (standing)
  await waitFor(() => expect(setSetting).toHaveBeenCalledWith(expect.objectContaining({ key: "grading.standingBands", value: expect.any(Array) })));
});
it("blocks Save with an empty label or non-numeric minGpa", async () => { /* validation */ });
it("hides the standing editor controls without config.manage", async () => { /* read-only */ });
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** a "Classification (standing) bands" section in `GradingTab`: load `core.getSetting({ key: "grading.standingBands" })` (default to the seed bands if it returns empty/`{}`), render editable rows (`label` text + `minGpa` number + remove), "Add band", validate (≥1 row, labels non-empty, `minGpa` finite), Save → `core.setSetting({ key: "grading.standingBands", value: rows })`. Gate edit controls by `config.manage`. Note: ordering need not be enforced (resolver sorts descending). Add the forward-only note.

- [ ] **Step 4: Run → PASS;** full suite green; tsc clean. Commit.

```bash
git add src/presentation/screens/ConfigurationScreen.tsx tests/ui/grading-editor.test.tsx
git commit -m "feat(ui): standing/classification bands editor"
```

---

## Phase 5 — Verify, docs & rebuild

### Task 5.1: Full verification

- [ ] **Step 1:** `npx tsc --noEmit` (clean); `npx eslint src tests --quiet` (clean); `npx prettier --check "src/**/*.{ts,tsx}" "tests/**/*.{ts,tsx}"` (clean — `--write` if not); `npx vitest run` (all green, count > pre-D).
- [ ] **Step 2:** Architecture fitness (`tests/architecture.test.ts`) — confirm the new presentation validation helpers don't import infra and the domain stays framework-free.

### Task 5.2: Docs

**Files:**

- Modify: `docs/superpowers/specs/2026-06-20-editable-grading-design.md` (Status → Implemented; tick §8 DoD)

- [ ] **Step 1:** Flip Status + tick the DoD boxes. Commit `docs: mark Workstream D implemented`.

### Task 5.3: Rebuild & reinstall

- [ ] **Step 1:** `npm run tauri build` — expect the MSI/EXE bundles written (the `TAURI_SIGNING_PRIVATE_KEY` updater step may exit non-zero AFTER the installers are produced; the artifacts are still valid). No new migration this workstream.
- [ ] **Step 2:** Reinstall from the MSI; smoke test: create a grade scale (gap blocks Save), edit a band, create an assessment structure (weights must total 100), edit the standing bands, and confirm a non-default scale can be deleted while the default cannot.

---

## Self-review notes (coverage map)

- **Spec §3 backend wiring** → Tasks 1.1 (contract), 1.2 (zod), 1.3 (compose/ipc/harness).
- **Spec §3 test gap** → Task 0.1.
- **Spec §4 grade-scale editor** → Tasks 2.1 (validation helper), 2.2 (modal + CRUD).
- **Spec §5 assessment editor** → Tasks 3.1, 3.2.
- **Spec §6 standing-bands editor + forward-only + permission gating + delete-default guard** → Tasks 4.1 (standing), and the gating/notes/Delete-disabled woven into 2.2/3.2/4.1.
- **Spec §7 layering/testing** → TDD per task + Task 5.1 fitness.

**Type-consistency checks:** contract inputs (1.1) match the use-case inputs (`{ name, bands }` / `{ id, name?, bands? }` / `{ id }`) and the UI calls (2.2/3.2); `BandRow`/`ComponentRow` (2.1/3.1) carry exactly the `GradeBand`/`AssessmentComponent` fields the use-cases expect; `grading.standingBands` key + `{ label, minGpa }[]` value are identical across 4.1 and the existing setting.

**Flagged verify-points (not blockers):** how `GradingTab` reads the current permissions to gate buttons (find the existing session/permission hook used elsewhere in `ConfigurationScreen.tsx`); the exact `useAsync` reload API for refreshing lists after a mutation; whether `tests/config/manage-grade-scales.test.ts` already exists (extend) or must be created (mirror the assessment one).
