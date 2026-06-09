# Architecture Review Report (Critical Self-Review)

**Project:** EARTMP · **Reviewer:** acting as independent architect · **Date:**
2026-06-08 · **Scope:** the Phase 0 design + the Phase 1 foundation as built.

This is a deliberately adversarial review of my own design. It is grounded in
the actual `prisma/schema.prisma`, the `reference-implementation/` code, and the
Phase 0 docs — not generic best-practice. Findings are severity-rated and each
carries a concrete recommendation and a disposition:

- **REVISE-NOW** — doc/design revision applied in this pass.
- **DECISION** — forks the design or conflicts with the mandated stack; needs
  your call (surfaced in chat).
- **PHASE** — correct to implement in a specific later phase; recorded so it is
  not forgotten.

Severity: 🔴 critical · 🟠 high · 🟡 medium · ⚪ low.

---

## 0. Headline finding (read this first)

🔴 **F-0 — The mandated stack pairs Prisma (a Node.js library) with Tauri 2 (a
Rust backend with no Node runtime). As specified, the data layer cannot run
inside the shipped desktop app.**

`@prisma/client` is a Node library; it executes in a Node/JS runtime and talks to
a native query-engine binary. A Tauri 2 app's backend is a **Rust** process —
there is no Node runtime in it. The webview runs JS, but it has no filesystem/
SQLite access and should never hold the DB. So "React UI → use-cases → Prisma →
SQLite" works today **only because the reference code runs under Node/Vitest**,
which masks the problem. The moment we package into Tauri, the Node-based data
layer has nowhere to run.

This is exactly the kind of conflict CLAUDE.md says to surface rather than build
around. Compliant options (all keep offline-first SQLite):

| Option                                    | Data layer in the app                                                                                               | Prisma's role                                                                                                                             | Cost                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **A. Tauri SQL plugin / Rust data layer** | `tauri-plugin-sql` or `sqlx` (Rust) in the Tauri core; repositories implemented in Rust or via a thin command layer | **dev-time only** — keep Prisma schema + `migrate` to author/version the SQLite schema; ship the generated SQL migrations, not the client | Re-implement repository ports against the Tauri SQL plugin; lose Prisma's typed client at runtime |
| **B. Node sidecar**                       | bundle a Node sidecar process running `@prisma/client`; Tauri talks to it over IPC                                  | full Prisma at runtime                                                                                                                    | ship a Node runtime + engine binary inside the app; larger binary; sidecar lifecycle/security     |
| **C. In-process JS SQLite**               | run the data layer in the webview/JS with `wa-sqlite`/`sql.js` (WASM) or `better-sqlite3` via a Node sidecar        | drop Prisma client; keep schema as reference                                                                                              | WASM SQLite persistence/perf caveats; still no Prisma at runtime                                  |
| **D. Web-first now, defer Tauri**         | keep Prisma + Node for a web/Electron build; revisit Tauri later                                                    | full Prisma                                                                                                                               | departs from the Tauri-2 mandate                                                                  |

**Recommendation: Option A.** Keep Prisma as the **schema-authoring + migration**
tool (it's excellent at that, and our 23-table schema + migration already work),
but implement the runtime repositories against the **Tauri SQL plugin** so the
data layer lives where the app actually runs. This preserves the Clean
Architecture seam perfectly — the domain depends on repository _ports_, so
swapping the Prisma-backed implementation for a Tauri-SQL-backed one touches only
`infrastructure/`. **DECISION required** — see chat.

> Everything below assumes we resolve F-0. Most other findings are independent of
> which option is chosen because they live at the domain/application layer or in
> the schema (which both A and B keep).

---

## 1. Architectural weaknesses

🔴 **F-1 — No transaction / Unit-of-Work boundary. `ProcessSemesterResults`
writes results in a non-atomic loop.** The reference use-case does
`for (...) await this.results.update(...)` with **no transaction**. A failure
mid-loop leaves a half-processed semester — some results graded, others not —
on a permanent-records system. _Recommendation:_ introduce a `UnitOfWork`/
transaction port; every multi-write use-case runs inside one atomic boundary.
**REVISE-NOW** (design) + **PHASE 7/9** (impl).

🟠 **F-2 — N+1 query pattern baked into the core use-case.**
`ProcessSemesterResults` calls `courses.findById(r.courseId)` once per result
inside the loop. Transcript generation (8 semesters × ~10 courses) and cohort
processing multiply this into hundreds of round-trips. _Recommendation:_ add
batch reads to the repository ports (`findByIds`, `findByStudentWithCourses`),
or a read-model/projection for reporting. **REVISE-NOW** (ports) + **PHASE 7**.

🟠 **F-3 — Generic `Repository<T>` CRUD leaks an anti-DDD mindset and does not
enforce invariants.** `update(id, Partial<T>)` will happily update a **locked**
result or a finalized student — the `isLocked` / `status` invariants live in
`StudentRules`/`TranscriptRules` but nothing forces the repository or use-case to
consult them. _Recommendation:_ either make mutations go through guarded
domain-service methods, or have repositories reject writes to locked aggregates
(fail-closed). **REVISE-NOW** (design) + **PHASE 7/9**.

🟡 **F-4 — Anemic domain model.** `Student`/`Course`/`ResultRecord` are plain
interfaces; behaviour sits in side objects (`StudentRules`). This is procedural,
not the "rich domain model" the SAD claims. Acceptable, but we should stop
calling it DDD-rich or move invariants onto constructors/factory functions.
**REVISE-NOW** (honesty in SAD).

🟡 **F-5 — Stringly-typed DI container.** `resolve<T>("token")` has no compile-
time guarantee that `T` matches the registered factory; a typo is a runtime
crash. Fine for a small app, but flag it; consider symbol/typed tokens.
**PHASE 2** (when registrations begin).

🟡 **F-6 — Config validated "on read" with no single choke point.** Nothing
guarantees every reader of `GradeScale.bands`/`AssessmentConfig.components`
routes through the validating value object; a forgetful path uses raw JSON and
drifts. _Recommendation:_ a single `ConfigLoader` service is the **only** gateway
to config blobs; repositories return validated value objects, never raw strings.
**REVISE-NOW** (design) + **PHASE 8**.

---

## 2. Scalability risks

🟠 **F-7 — `findAll(): Promise<T[]>` has no pagination/filtering.** On
`Student` (10k+) and `Result` (100k+) this loads entire tables into memory for a
list screen. _Recommendation:_ replace with `find(query: {where, orderBy, skip,
take})` returning a page + count. **REVISE-NOW** (ports) + **PHASE 6/7**.

🟠 **F-8 — GPA/CGPA recomputed from raw results every time; no materialized
per-semester GPA.** `Result` stores grade/gradePoint/creditsEarned but there is
no `SemesterGpa` snapshot. A class graduation report is O(students × all their
results) recomputed live. _Recommendation:_ persist a per-student-per-semester
GPA projection (a cache table), invalidated when results change. **DECISION**
(adds a table) + **PHASE 11**.

🟡 **F-9 — SQLite single-writer + no WAL/pragma plan.** Concurrent import + UI
writes serialize; default journal mode limits reader/writer concurrency.
_Recommendation:_ enable **WAL**, set `busy_timeout`, `synchronous=NORMAL`, and
chunk bulk import into bounded transactions. **REVISE-NOW** (design) +
**PHASE 1 amendment / 10**.

🟡 **F-10 — JSON columns are opaque to SQL.** `Result.componentScores`,
`GradeScale.bands`, etc. can't be filtered/aggregated in queries (analytics,
"all students who scored < 40 in X"). Acceptable for v1; note the limit and lean
on SQLite JSON1 functions if needed. **PHASE (analytics, later).**

🟡 **F-11 — Full-copy backups scale linearly with a growing DB.** An 800k-row DB
copied on every schedule grows in time/size. _Recommendation:_ WAL-checkpoint +
`VACUUM INTO` for consistency; consider incremental/rotational retention.
**PHASE 18.**

---

## 3. Security risks

🔴 **F-12 — Primary database is unencrypted; only backups are encrypted.** The
live SQLite file holds full student PII in plaintext. Device theft = full breach,
yet we encrypt backups. Inconsistent and a real exposure. _Recommendation:_
encrypt the primary DB at rest — **SQLCipher** (or the Tauri SQL plugin's
encryption) — keyed from the operator passphrase; or, at minimum, mandate OS
full-disk encryption as a documented deployment control. **DECISION** (affects
the data-layer choice in F-0) + **PHASE 2/18**.

🟠 **F-13 — Authorization relies on each use-case remembering to check.** There
is no enforced, fail-closed seam; a new use-case that forgets its permission
check is a silent privilege hole. _Recommendation:_ a mandatory authorization
decorator/middleware around every use-case that **denies by default** unless the
use-case declares required permissions; the check cannot be skipped.
**REVISE-NOW** (design) + **PHASE 2**.

🟠 **F-14 — Transcript verification is a self-referential hash, not a
signature.** The QR encodes a hash of the snapshot; verification recomputes it
**from the same local DB**. A third party holding only the PDF cannot verify, and
anyone who can write the DB can forge a matching hash. _Recommendation:_ sign the
snapshot with the institution's **private key** (asymmetric); the QR carries the
signature; verification uses the public key and needs no DB. This is the
difference between "tamper-evident to us" and "verifiable by a third party."
**DECISION** + **PHASE 12/13**.

🟠 **F-15 — Audit log is app-level append-only but not tamper-evident.** A direct
edit of the SQLite file can alter/delete audit rows; we deferred hash-chaining to
"future." For legal records that is too late. _Recommendation:_ promote
**hash-chained audit entries** (each row hashes the previous) to a launch
requirement so deletion/reordering is detectable. **REVISE-NOW** (promote) +
**PHASE 17**.

🟡 **F-16 — Tauri IPC must not trust webview-supplied identity.** If a command
accepts a `userId`/role from the JS side, the webview can escalate. _Recommend:_
the session/identity lives in the Rust core; commands derive the actor from the
authenticated session, never from arguments; minimal typed allowlist.
**REVISE-NOW** (design) + **PHASE 2**.

🟡 **F-17 — PII inside `AuditLog.oldValue/newValue`.** Full before/after PII
snapshots in the audit log create a second PII store and an export-leak path.
_Recommendation:_ minimize/redact PII in audit payloads, or field-level
allowlist; define audit retention. **PHASE 17.**

🟡 **F-18 — Account-recovery / SUPER_ADMIN lockout.** No password-reset or
recovery path; a lost sole-admin credential + passphrase = permanent lockout
offline. _Recommendation:_ recovery-code mechanism + at least two admin accounts
by policy. **PHASE 2.**

---

## 4. Database design issues

🟠 **F-19 — No provenance of which `GradeScale`/`AssessmentConfig` produced a
result.** `Result` stores `grade`/`gradePoint` but not the scale/config used. If
the default scale is later edited, you **cannot reproduce** how a historical
grade was derived — a serious auditability gap for permanent records.
_Recommendation:_ store `gradeScaleId` + `assessmentConfigId` on `Result` (or
freeze them per `Semester`), so every grade is reproducible. **DECISION**
(schema change) + **PHASE 9.**

🟠 **F-20 — Soft-delete vs unconditional `@unique` is a live correctness bug
today.** Re-creating a soft-deleted `Course.code` (or `matricNumber`) fails right
now because the tombstone still holds the unique value. We deferred the partial-
unique fix. _Recommendation:_ schedule the raw-SQL partial unique index +
repository-level handling firmly for P5/P6 and track it as a known defect until
then. **PHASE 5/6** (already flagged).

🟡 **F-21 — `Student.facultyId` is a denormalized scalar with no relation.** It
can drift from `department → faculty`. _Recommendation:_ derive faculty via
department, or add the real relation + a consistency check. **REVISE-NOW**
(decision recorded) + **PHASE 5.**

🟡 **F-22 — No enrollment/programme history.** `Student` has a single
`programmeId`/`levelId`; programme transfers and level progression over time are
not historized, so a transcript spanning a transfer can't represent it.
_Recommendation:_ a `StudentEnrollment` history table (student, programme, level,
fromSession, toSession). **DECISION** (new table) + **PHASE 5/6.**

🟡 **F-23 — Course definition conflates with course offering.** `Course` carries
`levelId`/`semesterRank` on the definition; retakes/electives offered across
levels/sessions are rigid. _Recommendation:_ consider a `CourseOffering` join
(course × session/semester) if the institution reuses courses flexibly.
**DECISION** (modeling) + **PHASE 5.**

🟡 **F-24 — Enumerations are free strings with no DB CHECK constraints.** A raw
SQL/migration write can store an invalid `status`. _Recommendation:_ add SQLite
`CHECK` constraints (raw-SQL migration) as a last line behind the Zod/domain
guard. **PHASE 1 amendment.**

🟡 **F-25 — Config JSON blobs lack a `schemaVersion`.** `bands`/`components` have
no version field (the transcript `layout` does), so evolving their shape later is
risky. _Recommendation:_ embed `schemaVersion` in every config blob; validate/
migrate on read. **REVISE-NOW** (convention) + **PHASE 8.**

🟡 **F-26 — FK scalar fields may be unindexed.** Prisma/SQLite do not auto-index
all FK columns (`Department.facultyId`, `Programme.departmentId`, `User.roleId`,
etc.); joins/filters on them table-scan. _Recommendation:_ add `@@index` on the
hot FK columns. **REVISE-NOW** (schema) + **PHASE 1 amendment.**

🟡 **F-27 — No optimistic-concurrency version column.** We rely on comparing
`updatedAt`; an integer `version` is more robust against races. _Recommendation:_
add `version Int @default(0)` to mutable aggregates if multi-user is real.
**DECISION** + **PHASE (when multi-user confirmed).**

---

## 5. Transcript engine limitations

🟠 **F-28 — Re-rendering an "issued" transcript is not actually guaranteed
identical.** The `snapshot` freezes the _data_, but rendering also needs the
_template/layout_; if the template is edited or deleted, the historical layout is
gone. _Recommendation:_ snapshot the **resolved layout** (or the final rendered
PDF bytes + their hash) alongside the data, so reproduction is exact. **REVISE-
NOW** (design) + **PHASE 12.**

🟡 **F-29 — The template `layout` is a home-grown DSL that will accrete
complexity.** Real transcripts need conditionals, computed/derived fields,
per-row styling, grade-key legends, page-break/continuation headers, totals.
A bespoke block language tends to grow fragile. _Recommendation:_ keep the DSL
deliberately small and explicit about what it does **not** support; reassess vs a
mature templating approach once the real sample is in. **PHASE 12/15.**

🟡 **F-30 — PDF↔DOCX "parity from one resolved doc" is optimistic.** PDFMake and
`docx` have different layout models; pixel/section parity (and faithful
reproduction of an official sample with seals/watermarks/repeating headers) is
hard. _Recommendation:_ treat PDF as canonical, DOCX as best-effort editable;
golden-master each separately; validate against the real sample early. **PHASE
13/14.**

🟡 **F-31 — `ReportData` shape is unpinned (`[ASSUMPTION]`).** The binder and
template can't be finalized until the real transcript sample defines required
fields. Tracked. **PHASE 12** (needs the sample).

---

## 6. Offline-first challenges

🔴 **F-0 (restated)** — Prisma(Node)/Tauri(Rust) runtime mismatch — see §0.

🟠 **F-32 — Migrations on end-user machines.** `prisma migrate deploy` needs the
Prisma CLI/engine present at runtime — not available in a packaged Tauri app.
_Recommendation:_ under Option A, ship the generated SQL migrations and apply
them with the Tauri SQL plugin's migration runner on first launch; under B, the
sidecar runs them. **DECISION** (tied to F-0) + **PHASE 1/2.**

🟡 **F-33 — Untrusted local clock.** Offline devices can have wrong/altered
clocks; transcript timestamps and audit ordering depend on it with no trusted
time source. `ClockPort` aids testing, not trust. _Recommendation:_ document the
limitation; consider monotonic sequence numbers for audit ordering independent of
wall-clock. **PHASE 17.**

🟡 **F-34 — No sync/merge/conflict strategy for "USB export" / "future multi-
institution."** CUID PKs anticipate merges, but there is no conflict-resolution
design for moving data between machines. _Recommendation:_ declare v1
single-machine authoritative; design sync only when the requirement is real.
**PHASE (future).**

🟡 **F-35 — Single-file corruption resilience.** Power loss mid-write can corrupt
the DB. _Recommendation:_ WAL + checkpointing + periodic `PRAGMA
integrity_check` + the backup cadence already planned. **PHASE 1 amendment / 18.**

---

## 7. What I got right (kept after review)

- Domain purity is real and **mechanically enforced** (fitness test + lint), not
  aspirational — the strongest part of the design.
- Configuration-as-data (validated grade scales/assessment structures) genuinely
  delivers multi-institution without recompilation.
- CGPA by aggregate quality points (not mean of GPAs) is correct and tested.
- Soft-delete + append-only audit modeling is sound in intent.
- Snapshot-based transcripts (once F-28 is fixed) give reproducibility.

---

## 8. Disposition summary

| Severity    | Count | IDs                                                           |
| ----------- | ----- | ------------------------------------------------------------- |
| 🔴 Critical | 4     | F-0, F-1, F-12, (F-0 restated)                                |
| 🟠 High     | 9     | F-2, F-3, F-7, F-8, F-13, F-14, F-15, F-19, F-32              |
| 🟡 Medium   | 18    | F-4…F-6, F-9…F-11, F-16…F-18, F-20…F-27, F-29…F-31, F-33…F-35 |

**Decisions — RESOLVED (2026-06-08, recorded as ADR-007…011 in the SAD):**

1. **F-0 / F-32** — ✅ **Option A**: Tauri SQL plugin at runtime; Prisma dev-time
   only (schema + migrations). → ADR-007.
2. **F-12** — ✅ **Encrypt the primary DB** at rest with SQLCipher. → ADR-008.
3. **F-14** — ✅ **Digital signature** verification (institution key). → ADR-009.
4. **F-19/F-22/F-23/F-27 (+ F-24/F-25/F-26)** — ✅ **Bundle** into a single
   revised-schema migration reviewed **before Phase 5**. → ADR-010.

Also adopted: ADR-011 (transactional use-cases + fail-closed authorization,
F-1/F-13) and the ADR-006 amendment (snapshot captures layout, F-28).

**Applied in this pass (REVISE-NOW):** see the revision banners added to
[solution-architecture.md](solution-architecture.md),
[database-design.md](database-design.md),
[security-architecture.md](security-architecture.md), and
[transcript-template-architecture.md](transcript-template-architecture.md), and
the new risks R-8…R-12 in the SAD.

_Related: [solution-architecture.md](solution-architecture.md) ·
[implementation-plan.md](implementation-plan.md)_
