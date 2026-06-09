# Phase 7 — Repositories & Persistence

**Project:** EARTMP · **Phase:** 7 · **Status:** Plan drafted, awaiting approval
to implement · **Predecessor:** Phase 6 (implemented)

> Deliverables-before-implementation spec, in the mandated format. Nothing is
> built until you approve. **This phase has a sequencing decision to make first
> (§0).**

---

## 0. Decision required first — the Tauri-SQL reality (ADR-007)

ADR-007 says the **runtime** data layer is the **Tauri SQL plugin (Rust)**, with
Prisma kept dev-only. But that runtime layer **only exists inside a Tauri app**,
and **the Tauri shell has not been built yet** (UI + shell were deferred every
phase). So "implement the production repositories" cannot happen headlessly — it
requires standing up the Rust/Tauri shell, and code there can't run under our
Vitest proof model.

Three ways to scope Phase 7:

| Option                                                           | What Phase 7 does                                                                                                                                                                                                                                                                                                                                                                                                    | Pros                                                                                                                                                                            | Cons                                                                                                                                                      |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Persistence foundation now, Tauri-SQL later (recommended)** | Build the **patterns** that are persistence-agnostic and testable: `UnitOfWork`/transaction port, **atomic** use-cases (F-1), **optimistic-lock** enforcement (version), reconcile the two Course ports, and **first integration tests against a real SQLite DB** (via the existing Prisma dev layer + a temp DB). Schedule the **Tauri shell + Tauri-SQL plugin repos** as the next dedicated phase (7b / "Shell"). | Keeps the headless proof model + ≥80% coverage; delivers real value (transactions, optimistic locking, integration tests); de-risks the eventual Tauri swap; no premature Rust. | Doesn't physically implement Tauri-SQL yet (it's genuinely shell-blocked).                                                                                |
| **B. Bring up the Tauri shell now**                              | Scaffold `src-tauri` (Rust), `tauri-plugin-sql`, IPC command surface, re-implement repositories in the Tauri-SQL layer, wire the composition root.                                                                                                                                                                                                                                                                   | Lands ADR-007 physically.                                                                                                                                                       | Large; **breaks the headless test model** (Tauri code can't run under Vitest); Rust toolchain + packaging; high risk; couples persistence to UI bring-up. |
| **C. Minimal — abstraction only**                                | Just the `UnitOfWork` port + optimistic-lock pattern on the Prisma dev layer; no integration tests.                                                                                                                                                                                                                                                                                                                  | Smallest.                                                                                                                                                                       | Leaves persistence largely unproven; less value.                                                                                                          |

**Recommendation: Option A.** The Tauri SQL plugin is itself _raw SQL over
SQLite_ — the same shape as the Prisma dev layer behind a transaction. Proving the
`UnitOfWork` + optimistic-locking + reconciled ports now (with real integration
tests) means the later Tauri-SQL implementation is a thin, well-specified
translation, not a redesign. The rest of this plan assumes **Option A**; if you
prefer B or C, say so and I'll re-scope.

---

## Executive Summary (assuming Option A)

Phase 7 builds the **persistence foundation**: a `UnitOfWork` transaction port so
multi-write use-cases are **atomic** (fixes review finding **F-1** —
`ProcessSemesterResults` currently writes results in a non-atomic loop),
**optimistic-locking enforcement** using the `version` columns from Phase 5
(fixes the lost-update risk behind **F-27**), and a single **reconciled** set of
repository ports (closing the two-Course-ports debt from Phase 6). It adds the
project's first **integration tests** against a real SQLite database.

---

## Objectives

1. A `UnitOfWork` (transaction) port; a Prisma-backed implementation using
   `$transaction`; multi-write use-cases run inside one atomic boundary.
2. **Optimistic-locking** helper: writes to versioned aggregates
   (`Result`/`Student`/`Transcript`) check-and-increment `version`; a stale write
   throws a typed `ConcurrencyError`.
3. **Reconcile repository ports**: one canonical `CourseRepository`
   (the paginated Phase 6 one); adapt the reference `ProcessSemesterResults` to it
   and retire the legacy generic port (or formally alias it).
4. **Integration test harness**: spin up a temp SQLite DB (migrate + a tiny
   fixture), run repositories + a transactional use-case end-to-end, assert
   atomic rollback on failure and version conflict detection.
5. Wire the **DI composition root** to assemble the dev (Prisma) repositories +
   UoW for the demos.

**Out of scope (next phase):** the Tauri shell, the Tauri-SQL plugin repositories,
IPC, packaging, UI.

---

## Deliverables

| #   | Deliverable                                                                                                                                                   | Layer         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| D1  | `UnitOfWork` port (`run(work): Promise<T>` giving transactional repos) + `ConcurrencyError`                                                                   | app/domain    |
| D2  | Prisma-backed `UnitOfWork` impl (`$transaction` interactive)                                                                                                  | infra (dev)   |
| D3  | Optimistic-lock helper + `version` check-and-increment in versioned repo updates                                                                              | infra + app   |
| D4  | Make `ProcessSemesterResults` **atomic** (process + persist all results in one UoW) and use the canonical `CourseRepository` (fixes F-1)                      | application   |
| D5  | Reconcile ports: retire/alias the legacy generic `StudentRepository`/`CourseRepository` in `repositories/index.ts`; update the reference use-case + its fakes | domain/app    |
| D6  | DI composition-root wiring for dev repos + UoW (`buildContainer`)                                                                                             | infra         |
| D7  | **Integration tests** against a temp SQLite DB: repo round-trips, atomic rollback, version conflict                                                           | tests         |
| D8  | `scripts/demo-persistence.ts` — atomic process + a forced rollback + a version conflict                                                                       | scripts (dev) |
| D9  | `/docs` update + implementation notes; a short **Tauri-SQL implementation spec** for the shell phase                                                          | docs          |

---

## Architecture Decisions

- **AD7.1 — `UnitOfWork` is a port; the impl is swappable.** The Prisma-backed
  impl is dev-only (ADR-007); the Tauri-SQL impl (shell phase) implements the same
  port. Use-cases depend only on the port.
- **AD7.2 — Atomic multi-write (F-1).** Any use-case that writes more than one row
  runs inside `uow.run(...)`; a failure rolls everything back. No partial
  semesters.
- **AD7.3 — Optimistic locking (F-27).** Versioned updates take the expected
  `version`; `UPDATE ... WHERE id = ? AND version = ?` (or Prisma equivalent);
  zero rows affected ⇒ `ConcurrencyError`. The new version is returned.
- **AD7.4 — One canonical port set.** Eliminate the duplicate Course port; the
  paginated Phase 6 ports are canonical. The reference `ProcessSemesterResults`
  migrates to them.
- **AD7.5 — Integration tests use a throwaway DB**, created per run (migrate +
  seed-lite), torn down after — never the operator dev.db.

---

## Database Changes

- **None.** The `version` columns and indexes already exist (Phase 5). This phase
  is behavioural (transactions + version checks).

---

## UI Screens

**None.**

---

## Services / Contracts (abridged)

- `UnitOfWork.run<T>(work: (repos: Repos) => Promise<T>): Promise<T>` — commit on
  resolve, rollback on throw.
- `ConcurrencyError` — thrown on a stale-version write.
- `ProcessSemesterResults.execute(...)` — now wraps its writes in `uow.run`.

---

## Validation Rules

- A multi-write use-case must not perform writes outside a UoW (enforced by an
  architecture test that flags direct repo writes in such use-cases `[stretch]`).
- Versioned updates require the expected version; mismatch ⇒ `ConcurrencyError`.

---

## Test Plan

| Test                          | Asserts                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| UoW commit                    | all writes in a `run` persist on success                                                       |
| UoW rollback                  | a throw mid-`run` rolls back **all** writes (atomicity, F-1)                                   |
| optimistic lock               | concurrent update with a stale version ⇒ `ConcurrencyError`; fresh version increments          |
| ProcessSemesterResults atomic | a failure on the Nth result leaves zero results persisted                                      |
| port reconciliation           | reference use-case + fakes compile/run against the canonical ports; existing suites stay green |
| integration                   | temp-DB repo round-trips for student/course/result                                             |
| coverage                      | ≥80% on new code                                                                               |

Unit tests stay headless; integration tests use a temp SQLite DB (real SQL).

---

## Risks

| ID   | Risk                                                                | Mitigation                                                                                        |
| ---- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| P7-a | Tauri-SQL deferred too long                                         | the implementation spec (D9) + the port design make the shell-phase work mechanical; flag clearly |
| P7-b | Prisma `$transaction` interactive semantics vs the future Tauri-SQL | keep the UoW contract minimal (run/commit/rollback); both honour it                               |
| P7-c | Reconciling ports breaks the reference use-case/tests               | do it behind green tests; adapt fakes in the same change                                          |
| P7-d | Integration tests flaky on temp DB lifecycle                        | unique temp file per run; explicit teardown; no shared state                                      |

---

## Completion Criteria

- [ ] `UnitOfWork` + optimistic locking implemented; multi-write use-cases atomic (F-1).
- [ ] Course ports reconciled to one canonical set; reference use-case migrated.
- [ ] Integration tests (atomic rollback + version conflict) pass against a temp DB.
- [ ] `demo:persistence` shows commit, rollback, and a version conflict.
- [ ] Tests pass; coverage ≥80% on new code; `tsc` strict clean; lint/format clean.
- [ ] `/docs` updated incl. the Tauri-SQL implementation spec for the shell phase.
- [ ] Summary posted; **approval requested before the next phase.**

---

## Approval Checklist (to start Phase 7 implementation)

- [ ] **§0 decision:** **Option A** (persistence foundation now, Tauri-SQL in a
      dedicated shell phase) — or B (bring up the Tauri shell now) / C (minimal)?
- [ ] Optimistic-lock scope: `Result`/`Student`/`Transcript` — OK, or wider?
- [ ] Reconcile the Course ports now (retire the legacy generic port) — OK.
- [ ] Add integration tests against a temp SQLite DB — OK.
- [ ] Go-ahead to implement.

_Related: [architecture-review.md](../phase-0/architecture-review.md)
(F-1, F-27, F-0/ADR-007, F-3) · [phase-6 implementation notes](../phase-6/implementation-notes.md)_
