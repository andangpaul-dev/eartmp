# Detailed Implementation Plan (Phase-by-Phase)

**Project:** EARTMP · **Phase:** 0 · **Status:** Draft, awaiting approval

This is the reconstructed roadmap. CLAUDE.md states the BSD defines **20 phases,
executed in order, one at a time, with explicit human approval between each** and
that **no future-phase code may be written**. The original BSD was not present in
the repo, so the 20-phase breakdown below is **`[ASSUMPTION]`** — it is
engineered to honour the known anchors and must be reconciled with the real BSD:

- **Phase 0 = Solution Design** (this doc set). ✅ in progress.
- Reference material is earmarked for **Phases 4 / 7 / 9** (engines, repository
  ports, transcript) per CLAUDE.md — the plan keeps those anchors.
- "No application code before approval" (BSD §3/§11).

Each phase follows the mandated output format: **Objectives · Deliverables ·
Architecture Decisions · Database Changes · UI Screens · Services · Tests ·
Risks · Completion Criteria.** Below, phases are summarised; the _active_ phase
is always expanded to full detail in its own working doc when it begins.

> **⚠ Post-review amendments (2026-06-08) — see
> [architecture-review.md](architecture-review.md), ADR-007…011.** Three plan
> impacts: (1) **before Phase 5**, run a bundled **schema-revision** pass
> (provenance, enrollment history, course offering, version column, FK indexes,
> CHECK constraints, JSON `schemaVersion`) — ADR-010. (2) **Phase 7
> (Repositories)** now implements ports against the **Tauri SQL plugin** (Rust),
> not `@prisma/client`; Prisma stays dev-time only (ADR-007). (3) **Phase 2**
> adds the **fail-closed authorization seam** and DB-at-rest encryption groundwork
> (ADR-008/011), and every multi-write use-case is **transactional** (ADR-011).

---

## Governance recap (applies to every phase)

- Deliverables **before** implementation.
- Ship **tests** every phase (Vitest/RTL), **≥ 80% coverage**.
- `tsc --noEmit` clean (strict); architecture boundaries intact.
- Update `/docs`.
- **Stop and request approval** before the next phase.

---

## Phase map (0–19) `[ASSUMPTION]`

| #   | Phase                          | Theme                                            | Reference anchor         |
| --- | ------------------------------ | ------------------------------------------------ | ------------------------ |
| 0   | Solution Design                | the 10 Phase-0 docs                              | — (current)              |
| 1   | Project & DB Foundation        | tooling, Prisma migrations, seed                 | schema exists            |
| 2   | Auth & RBAC                    | users, roles, permissions, Argon2, login         | security-arch            |
| 3   | Institution & Settings         | institution profile, config store                | —                        |
| 4   | **Domain Engines**             | GradeScale, AssessmentStructure, GpaEngine       | **reference Phase 4**    |
| 5   | Academic Structure             | faculty→dept→programme→level, sessions/semesters | —                        |
| 6   | Students & Courses             | CRUD, registries, soft delete                    | —                        |
| 7   | **Repositories & Persistence** | Prisma impls of ports, mappers, UoW              | **reference Phase 7**    |
| 8   | Assessment & Grading Config    | manage scales/structures (JSON config)           | engines                  |
| 9   | **Results & Processing**       | entry, `ProcessSemesterResults`, locking         | **reference (use-case)** |
| 10  | Spreadsheet Import             | SheetJS reader, validation, error report         | —                        |
| 11  | GPA/CGPA & Standing            | cumulative views, standing bands                 | engines                  |
| 12  | **Transcript Engine**          | template binder, snapshot, numbering             | **reference Phase 9**    |
| 13  | Reporting — PDF                | PDFMake renderer, branding, QR                   | reporting-arch           |
| 14  | Reporting — DOCX               | docx renderer                                    | reporting-arch           |
| 15  | Transcript Template Designer   | structured layout editor, versioning             | template-arch            |
| 16  | Graduation Eligibility         | configurable rules, graduation report            | —                        |
| 17  | Audit & Notifications          | audit interceptor, audit viewer, alerts          | security-arch            |
| 18  | Backup & Recovery              | compressed+encrypted backup, restore, USB        | security-arch            |
| 19  | Hardening & Release            | perf (100k rows), a11y, packaging, e2e           | all                      |

> If the real BSD differs (e.g. groups these differently or has different
> numbering), **its** ordering wins and this table is revised. The anchors
> (engines≈4, repos≈7, transcript≈9) are preserved because CLAUDE.md names them.

---

## Detailed phase specs

Below, each phase is given the full mandated structure. (Phases beyond the
immediate next are intentionally lighter; they are fleshed out to full detail in
their own doc when they become active — per "deliverables before
implementation.")

### Phase 1 — Project & Database Foundation

- **Objectives:** establish the buildable app skeleton and a migratable DB.
- **Deliverables:** ESLint/Prettier/Vitest/CI config; layer folders with
  boundary lint rules; `prisma migrate` working; idempotent seed; architecture
  fitness test.
- **Architecture decisions:** path aliases; composition-root location; partial
  unique indexes for soft-deleted rows ([database-design.md](database-design.md) §6).
- **Database changes:** initial migration from the 23-table schema; add
  recommended secondary indexes ([database-design.md](database-design.md) §4 `[ADD]`).
- **UI screens:** none (or a bare app shell).
- **Services:** none business; DI scaffolding + `PrismaClient` singleton.
- **Tests:** migration applies on a temp DB; seed is idempotent; boundary test
  fails on a forbidden import (proves enforcement).
- **Risks:** R-3 (Prisma binary/offline) — mitigate per env-setup.
- **Completion criteria:** `npm test`, `tsc --noEmit`, lint, and a clean migrate
  all pass in CI.

### Phase 2 — Authentication & RBAC

- **Objectives:** secure login + permission enforcement at the use-case edge.
- **Deliverables:** `HashingPort`+Argon2 impl; auth use-cases (login, change
  password); RBAC guard; seeded roles/permissions.
- **Database changes:** seed `Role`/`Permission`/`RolePermission`; first `User`.
- **UI screens:** Login, change-password, user/role admin.
- **Services:** `AuthenticateUser`, `AuthorizeAction`, `ManageUsers`.
- **Tests:** hash verify; wrong password generic failure; permission-denied path;
  `LOGIN` audit entry written.
- **Risks:** Argon2 cost tuning; user enumeration.
- **Completion criteria:** unauthorized use-case calls are rejected; coverage ≥80%.

### Phase 3 — Institution & Settings

- **Objectives:** runtime institution profile + typed settings store.
- **Deliverables:** institution CRUD; settings get/set (JSON); branding asset
  handling (logo/seal/signature paths).
- **Database changes:** none (tables exist); seed default `Institution`.
- **UI screens:** Institution profile, Settings.
- **Services:** `ManageInstitution`, `GetSetting`/`SetSetting`.
- **Tests:** settings round-trip JSON; calendar type validation.
- **Completion criteria:** branding consumed by later reporting.

### Phase 4 — Domain Engines (reference anchor)

- **Objectives:** the configurable calculation core.
- **Deliverables:** `GradeScale`, `AssessmentStructure`, `GpaEngine`, domain
  errors — **adapted from `reference-implementation/`** against the approved
  Phase 0 design (not pasted wholesale).
- **Database changes:** none (engines are pure; config stored as JSON in P8).
- **UI screens:** none.
- **Services:** the three engines + standing resolver.
- **Tests:** port the reference suite — band gap/overlap/coverage rejection;
  weights-sum-to-100; **CGPA by aggregate not mean**; rounding.
- **Risks:** R-2 (wrong formula per institution) — golden-master per profile.
- **Completion criteria:** engines run under Vitest with **no DB/UI**.

### Phase 5 — Academic Structure

- **Objectives:** faculty/department/programme/level + sessions/semesters.
- **Deliverables:** CRUD use-cases + screens; calendar (session→semester) with
  `(sessionId, rank)` uniqueness; "current session" toggle.
- **Database changes:** seed sample structure (dev only).
- **UI screens:** structure tree, session/semester manager.
- **Services:** `ManageFaculty/Department/Programme/Level`, `ManageCalendar`.
- **Tests:** uniqueness; soft-delete hides rows; ordering by `rank`.

### Phase 6 — Students & Courses

- **Objectives:** student records + course registry.
- **Deliverables:** Student/Course CRUD, search, soft delete, status workflow
  (`StudentRules`), course placement (dept/programme/level/semesterRank).
- **Database changes:** indexes for cohort queries (already in P1).
- **UI screens:** student list/detail/form, course registry.
- **Services:** `ManageStudents`, `ManageCourses`.
- **Tests:** matric/regNumber uniqueness; status-gated editability; search by
  department.

### Phase 7 — Repositories & Persistence (reference anchor)

- **Objectives:** Prisma-backed implementations of the domain ports.
- **Deliverables:** `PrismaStudentRepository`, `PrismaCourseRepository`,
  `PrismaResultRepository`, `PrismaTranscriptRepository`, `AuditLogAdapter`,
  row↔entity mappers, a transaction/UnitOfWork port + impl.
- **Database changes:** none (uses existing schema).
- **UI screens:** none.
- **Services:** repository implementations only.
- **Tests:** integration against a temp SQLite DB; soft-delete filtering;
  `existsFor`, `findByStudentAndSemester` correctness; mapper round-trips.
- **Risks:** R-5 (write throughput) — measured in P10/P19.
- **Completion criteria:** the same use-case tests pass against **real Prisma**
  and against in-memory fakes (boundary holds).

### Phase 8 — Assessment & Grading Configuration

- **Objectives:** manage grade scales & assessment structures as data.
- **Deliverables:** CRUD over `GradeScale`/`AssessmentConfig` (JSON validated
  through the engines on save/load); default selection.
- **Database changes:** seed default scale + structure.
- **UI screens:** grade-scale editor (bands), assessment-structure editor
  (weighted components, must total 100).
- **Services:** `ConfigureGradeScale`, `ConfigureAssessment`.
- **Tests:** invalid band config rejected at save; weights≠100 rejected; default
  flag uniqueness.

### Phase 9 — Results & Processing (reference use-case)

- **Objectives:** capture component scores, compute finals/grades/GPA, lock.
- **Deliverables:** result entry; `ProcessSemesterResults` (adapted from
  reference) wiring engines+repos+audit; `Result.isLocked` workflow + audited
  unlock.
- **Database changes:** none; `(studentId,courseId,semesterId)` uniqueness used.
- **UI screens:** result entry grid, process-semester action, lock/unlock.
- **Services:** `EnterResults`, `ProcessSemesterResults`, `UnlockResult`.
- **Tests:** final-score from components; grade resolution; GPA; duplicate
  prevented; locked result immutable; `PROCESS_SEMESTER` audit entry.
- **Risks:** R-2; partial processing.
- **Completion criteria:** end-to-end student→GPA verified.

### Phase 10 — Spreadsheet Import

- **Objectives:** bulk result/student import with validation.
- **Deliverables:** SheetJS reader; validation (student/course/assessment exists,
  marks in range, no duplicates); **error report**; `ImportResults` use-case;
  batched transactions.
- **UI screens:** import wizard (upload → preview → errors → commit).
- **Services:** `SpreadsheetReaderPort`, `ImportResults`.
- **Tests:** malformed file rejected; per-row error report; no partial commit on
  failure; 100k-row batch benchmark.
- **Risks:** R-5; malformed/huge files (security-arch §7).

### Phase 11 — GPA/CGPA & Academic Standing

- **Objectives:** cumulative views and standing classification.
- **Deliverables:** CGPA across sessions (aggregate); configurable standing
  bands; student academic summary.
- **UI screens:** student transcript-preview/summary, standing display.
- **Services:** `ComputeCgpa`, `ResolveStanding`.
- **Tests:** uneven-credit CGPA; standing band boundaries.

### Phase 12 — Transcript Engine (reference anchor)

- **Objectives:** template→snapshot→persisted transcript.
- **Deliverables:** template binder (layout JSON + `ReportData` → resolved doc);
  snapshot freeze; `verificationHash`; `nextTranscriptNumber`; `GenerateTranscript`.
- **Database changes:** seed Template V1; `Transcript` rows on generation.
- **UI screens:** generate transcript, transcript list, status workflow.
- **Services:** `GenerateTranscript`, `DocumentRendererPort` (interface).
- **Tests:** binder unit tests; stable hash; status gating; numbering uniqueness.
- **Risks:** R-4 (faithful layout); R-6 (config drift).

### Phase 13 — Reporting: PDF

- **Objectives:** render resolved doc to PDF.
- **Deliverables:** `PdfMakeRenderer`; branding/QR/signatures; DRAFT watermark;
  embedded fonts.
- **UI screens:** preview + export.
- **Tests:** golden-master docDefinition; export-gated by status; `EXPORT` audit.

### Phase 14 — Reporting: DOCX

- **Objectives:** editable Word output from the same resolved doc.
- **Deliverables:** `DocxRenderer`.
- **Tests:** golden-master DOCX model; parity of fields with PDF.

### Phase 15 — Transcript Template Designer

- **Objectives:** author/edit templates without code.
- **Deliverables:** structured block editor; template validation; versioning;
  default selection.
- **UI screens:** template designer, version history.
- **Services:** `ManageTemplates`.
- **Tests:** invalid layout rejected; version bump preserves issued snapshots.

### Phase 16 — Graduation Eligibility

- **Objectives:** evaluate graduation against configurable rules.
- **Deliverables:** `GraduationPolicy` (min CGPA, required credits, core passes —
  configurable); graduation report (a transcript `type`).
- **UI screens:** eligibility checker, cohort graduation report.
- **Services:** `EvaluateGraduation`.
- **Tests:** rule combinations; report generation. `[ASSUMPTION]` rules TBD.

### Phase 17 — Audit & Notifications

- **Objectives:** complete, queryable audit trail + operator alerts.
- **Deliverables:** audit interceptor on all writes; audit viewer (read-gated);
  notifications.
- **UI screens:** audit log viewer, notification center.
- **Services:** `QueryAuditLog`, `Notify`.
- **Tests:** before/after captured; append-only enforced; permission-gated read.

### Phase 18 — Backup & Recovery

- **Objectives:** durable, encrypted, restorable backups.
- **Deliverables:** consistent SQLite backup (Online Backup/`VACUUM INTO`),
  compress+AES-256-GCM encrypt, scheduling, USB export, restore-to-staging.
- **UI screens:** backup/restore manager, schedule config.
- **Services:** `BackupPort`, `CreateBackup`, `RestoreBackup`.
- **Tests:** backup→restore round-trip; integrity-check failure path; restore
  audited. **Risks:** R-7 (key management).

### Phase 19 — Hardening & Release

- **Objectives:** production readiness.
- **Deliverables:** performance pass (10k students / 100k results), a11y audit,
  Tauri capability lockdown, packaging/installers, end-to-end tests, docs final.
- **Tests:** load/perf benchmarks; e2e happy paths; security checks.
- **Completion criteria:** signed desktop build; all gates green.

---

## Cross-phase test & quality plan

- **Per phase:** unit + integration + validation/acceptance tests; **≥80%
  coverage**; `tsc` strict clean; boundary fitness test; `/docs` updated.
- **Golden-master suites:** GPA/CGPA per institution profile; transcript renders.
- **Benchmarks:** import + processing at target scale (Phase 10/19).

## Consolidated risk register

See [solution-architecture.md](solution-architecture.md) §9 (R-1…R-7). The
highest-leverage early mitigations: confirm the real BSD/SDP (R-1), lock the
Prisma offline workflow (R-3), and establish GPA golden masters (R-2) in Phase 4.

## Approval checklist (Phase 0)

- [ ] All 10 Phase-0 documents reviewed.
- [ ] Reconstruction assumptions (`[ASSUMPTION]`) accepted or corrected.
- [ ] 20-phase map approved or amended against the real BSD.
- [ ] Explicit approval given to begin **Phase 1** (no code until then).

_Related: every Phase-0 doc — see [README.md](README.md)._
