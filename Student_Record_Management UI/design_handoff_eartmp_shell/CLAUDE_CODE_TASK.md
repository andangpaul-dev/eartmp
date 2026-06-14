# Claude Code Task — Build the EARTMP desktop shell (`src/presentation/`)

> **Paste this whole file as your opening prompt in Claude Code, run from the
> root of the `Student_Record_Management` repo.** It orients Claude Code to the
> finished core, the design reference, and the integration package, then defines
> the build in verifiable milestones. Work milestone by milestone; don't skip the
> reconciliation step.

---

## Role & context

You are implementing the **frontend desktop shell** for **EARTMP** (EduCore
Academic Records & Transcript Management) — a Tauri 2 + React 19 + TypeScript,
offline-first (SQLite) registry app.

Three facts that define your job:

1. **The headless core is already complete** — all domain/application phases,
   271 passing tests. You are NOT writing business logic. You are building the UI
   and the thin host/webview seam that calls the core's existing use-cases.
2. **`src/presentation/` is an intentional placeholder.** The UI lives there and
   depends on application use-cases **through an IPC façade** — it must not import
   `src/infrastructure/**` or the DI container (enforced by
   `tests/architecture.test.ts`). Respect that boundary.
3. **You have a design reference and a wiring package** in this handoff folder
   (`design_handoff_eartmp_shell/`):
   - `design/EARTMP.dc.html` — the **hi-fi** clickable prototype (all 9 screens +
     config). Data is mocked. This is the source of truth for layout, color,
     type, spacing, copy, and interaction. Open `design/EARTMP-standalone.html`
     in a browser to click through it.
   - `integration/` — a typed **wiring scaffold** reconciled to the real core:
     `CoreApi`, the IPC client, the host dispatcher, React hooks, and a fully
     wired reference screen. **Read `integration/INTEGRATION.md` first** — it has
     the complete screen → use-case → permission map.
   - `brief/` — the original product brief + design-system spec.

**The HTML is a design reference, not code to ship.** Recreate it as real React
components using the repo's conventions; do not embed the HTML.

---

## Milestone 0 — Orient & reconcile (do this before any UI)

1. Read `integration/INTEGRATION.md` end to end.
2. Open these core files and **verify the names/types** the scaffold assumes,
   fixing any mismatch in `integration/src/presentation/runtime/contract.ts`:
   - `src/application/use-cases/**` — confirm each class `.name` and its
     input/output (Students, Results, Import, Transcripts, Graduation, Audit, Auth).
   - `src/application/authorization/AuthorizedUseCase.ts` — the `authorize()` gate.
   - `src/domain/value-objects/SessionContext.ts` — `has()/hasAll()`, permission list.
   - `src/domain/errors/**` — map class names → `CoreError` codes in
     `integration/src/presentation/runtime/errors.ts`.
   - The DI container (`src/infrastructure/di/**` or equivalent) — how providers
     are registered, so the host dispatcher can resolve use-cases by `.name`.
3. Resolve the open ⚠ items in INTEGRATION.md §5: the signing-key unlock op,
   container token convention, error mappings, and the `unknown` return types
   (`ProcessSemester`, config reads).

**Acceptance:** `contract.ts`, `errors.ts`, `dispatcher.ts` type-check against the
real core with no `any`/`unknown` left for known use-cases.

## Milestone 1 — Host/webview seam wired end to end

1. Copy the scaffold into the repo at the real paths:
   - `integration/src/presentation/**` → `src/presentation/**`
   - `integration/src/host/dispatcher.ts` → `src/host/dispatcher.ts`
2. Register the UI-reachable use-cases in the DI container keyed by `.name`.
3. Add ONE Tauri command `execute_use_case({ method, input })` that calls
   `dispatch(method, input)` and returns its `{ ok, data | error }` envelope.
4. Build `src/presentation/main.tsx` from `main.example.tsx`: build the IPC
   client, hydrate the session via `currentUser()`, mount React.

**Acceptance:** `architecture.test.ts` still passes; a smoke call (e.g.
`core.listStudents({take:1})`) returns real data from SQLite through the gate.

## Milestone 2 — App shell + auth

Recreate from the prototype: the navy sidebar (permission-gated nav, disabled
items with reason tooltips), the topbar (search, signing-key chip, user, lock),
the **login** screen (with the "change default password" banner), and the
**unlock signing-key** modal. Wire `useLogin` / `useLogout`; gate routes on session.

**Acceptance:** sign in with a seeded user → land on the shell; nav items the role
lacks are hidden/disabled; lock returns to login.

## Milestone 3 — Students (reference screen)

Implement Students list + profile + admit + status transition by porting the
prototype's markup onto the already-wired `StudentsScreen.tsx`. This proves the
whole pattern (read → 4 states → gate → mutate → confirm).

**Acceptance:** list paginates from the core; admit rejects a duplicate matric
with a field error (CoreError `CONFLICT`); status dropdown offers only
`canTransition` targets; every action shows loading/disabled correctly.

## Milestone 4 — Results + Import

Result entry (live final score from the core, not client math), Process Semester
(confirm → locks), and the Import wizard (upload → validate `dryRun:true` →
commit). Parse the workbook **on the host** and pass rows; render
`ImportReport.errors[]` as a scannable table; commit is all-or-nothing.

## Milestone 5 — Summary, Transcripts, A4, Graduation, Audit

Academic summary (display CGPA to 2 dp, never recompute), transcript list +
generate/verify/approve/export with DRAFT/APPROVED/LOCKED badges, the A4 serif
preview (DRAFT watermark; official export only when APPROVED/LOCKED; Ed25519
verify surfaced prominently), graduation eligibility + clear (re-checks on
confirm), and the append-only audit log + chain verify.

## Milestone 6 — Configuration & polish

Grade scale / assessment structure / institution / number-rule screens
(read-first, then edit). Sweep every screen for the required **loading / empty /
error / success** states and badge accessibility (color + label + icon).

---

## Hard rules (the core already enforces these — mirror, don't reimplement)

- UI calls `useCore()` only. No `invoke`, infra, SQL, or `authorize` in
  `src/presentation/**`.
- **Fail-closed gating**: `can('perm')` hides/disables; the host gate blocks; the
  core re-checks. Never show-then-error.
- Locked results are immutable without an audited unlock. Official transcript
  export requires APPROVED/LOCKED. CGPA is an aggregate (2 dp, display-only).
  Student status follows the core's matrix. A lost signing passphrase is
  unrecoverable — say so in the unlock modal.
- Destructive/irreversible actions (unlock result, graduate, approve, restore
  backup) go through a confirm dialog stating the consequence.

## Working agreement

- Use the repo's existing stack/conventions (check `package.json`, tsconfig path
  aliases, any component lib, lint rules) — match them, don't introduce new ones
  without asking.
- Keep `src/presentation` framework-clean per the architecture test; run it after
  each milestone.
- Pause after **Milestone 1** and show me the working smoke call before going on.
- The prototype is hi-fi: match its colors, IBM Plex type, spacing, and copy. See
  `README.md` in this folder for the exact design tokens and per-screen spec.
