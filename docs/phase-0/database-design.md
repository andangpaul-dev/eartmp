# Database Design Specification

**Project:** EARTMP · **Phase:** 0 · **Status:** Draft, awaiting approval
**Engine:** SQLite (offline-first) · **ORM (dev-time):** Prisma 6 · **Source of
truth:** `prisma/schema.prisma`

> **⚠ Post-review revisions (2026-06-08) — see
> [architecture-review.md](architecture-review.md).** Open items raised by the
> critical review that affect this schema: grade-scale/assessment **provenance on
> `Result`** (F-19), **enrollment/programme history** table (F-22), **course
> offering** vs definition (F-23), **`schemaVersion`** in every config JSON blob
> (F-25), **`@@index` on hot FK columns** (F-26), DB **CHECK constraints** for
> enums (F-24), and an optional optimistic-lock **`version`** column (F-27). The
> soft-delete vs `@unique` collision (§6) is a **live defect** until P5/P6
> (F-20). ORM pinned to **v6** (Prisma 7 dropped `url = env()`); the runtime data
> layer itself is subject to the F-0 decision.

This document specifies table definitions, column semantics, indexes,
constraints, conventions (soft-delete, timestamps, JSON config), and the Prisma
migration strategy. It is the normative companion to [erd.md](erd.md).

---

## 1. Design principles

1. **Single-file SQLite, offline-first.** `DATABASE_URL="file:./dev.db"` in dev;
   a per-OS app-data path in production.
2. **Soft delete everywhere except the audit log.** Every mutable table has
   `deletedAt DATETIME NULL`; repositories filter `deletedAt IS NULL` by default.
3. **Timestamps everywhere except the audit log.** `createdAt` (default now),
   `updatedAt` (`@updatedAt`). `AuditLog` carries only `createdAt` and is
   **immutable**.
4. **Configuration as JSON columns.** Variable institution rules
   (`GradeScale.bands`, `AssessmentConfig.components`,
   `TranscriptTemplate.layout`, `Result.componentScores`,
   `Transcript.snapshot`, `Setting.value`) are JSON strings validated by the
   domain layer — _never hardcoded_.
5. **CUID primary keys.** All tables use `@id @default(cuid())` string PKs:
   collision-resistant, sortable-ish, safe for offline generation and future
   multi-institution merges (no auto-increment collisions across machines).
6. **Enumerations as constrained strings.** SQLite has no native enum; allowed
   values are enforced in the domain/Zod layer and documented here (§7).

---

## 2. Conventions

### 2.1 Standard columns

Every mutable table includes:

```prisma
id        String    @id @default(cuid())
createdAt DateTime  @default(now())
updatedAt DateTime  @updatedAt
deletedAt DateTime?            // soft delete; NULL = live
```

`AuditLog` is the sole exception: `id` + `createdAt` only.

### 2.2 Soft-delete semantics

- A "delete" sets `deletedAt = now()`. Rows are never physically removed by
  application code (except by an explicit, audited purge/maintenance job — out
  of scope for v1).
- All repository reads add `WHERE deletedAt IS NULL` unless a method is
  explicitly `…IncludingDeleted`.
- Unique constraints interact with soft delete: see §6.

### 2.3 JSON column contract

JSON columns store domain configuration. On read, the value is parsed and
**validated through the owning value object** (e.g. `GradeScale.create(bands)`),
so a malformed or inconsistent blob is rejected rather than silently used. See
[transcript-template-architecture.md](transcript-template-architecture.md) and
[coding-standards.md](coding-standards.md) §"Validation".

---

## 3. Table definitions

Grouped by concern. Types shown as SQLite/Prisma. `UK`=unique, `FK`=foreign key,
`SD`=soft-delete column present.

### 3.1 Auth & RBAC

**Role** — a named set of permissions.
| Column | Type | Notes |
|---|---|---|
| id | String PK | cuid |
| name | String UK | `SUPER_ADMIN`, `REGISTRAR`, … |
| description | String? | |
| createdAt/updatedAt/deletedAt | — | SD |

**Permission** — a grantable capability.
| Column | Type | Notes |
|---|---|---|
| id | String PK | |
| key | String UK | e.g. `students.create` |
| label | String | human label |
| + standard cols | | SD |

**RolePermission** — join (many-to-many Role↔Permission).
| Column | Type | Notes |
|---|---|---|
| roleId | String FK→Role | |
| permissionId | String FK→Permission | |
| **PK** | (roleId, permissionId) | composite |

**User** — an operator account.
| Column | Type | Notes |
|---|---|---|
| id | String PK | |
| username | String UK | |
| email | String UK | |
| fullName | String | |
| passwordHash | String | **Argon2** hash; never plaintext |
| roleId | String FK→Role | exactly one role |
| isActive | Boolean | default true |
| lastLoginAt | DateTime? | |
| + standard cols | | SD |

### 3.2 Institution & settings

**Institution** — branding & policy for the deploying institution.
Key columns: `name`, `motto?`, `accreditationNo?`, contact fields, `logoPath?`,
`sealPath?`, `registrarSignPath?`, `calendarType` (default `SEMESTER`),
`transcriptNumberRule?`. SD.

**Setting** — typed key/value store (`value` is JSON). `key` UK. SD.

### 3.3 Academic structure

**Faculty** (`code` UK) → **Department** (`facultyId` FK, `code` UK) →
**Programme** (`departmentId` FK, `code` UK, `durationLevels`,
`creditsRequired`) → **Level** (`programmeId` FK, `name`, `rank`). All SD.

**AcademicSession** (`name` UK e.g. `2025/2026`, `isCurrent`) →
**Semester** (`sessionId` FK, `name`, `rank`; **UK `(sessionId, rank)`**). SD.

### 3.4 Students & courses

**Student**
| Column | Type | Notes |
|---|---|---|
| matricNumber | String UK | primary identifier |
| regNumber | String? UK | optional secondary id |
| fullName | String | |
| gender/dateOfBirth/nationality/address/telephone/email/photoPath | optional | |
| facultyId | String? | **scalar, no relation** (see ERD §5) |
| departmentId | String? FK→Department | |
| programmeId | String? FK→Programme | |
| levelId | String? FK→Level | current level |
| admissionSession | String? | |
| status | String | `ACTIVE`/`SUSPENDED`/`DEFERRED`/`WITHDRAWN`/`GRADUATED` |
| + standard cols | | SD |

**Course**
| Column | Type | Notes |
|---|---|---|
| code | String UK | |
| title | String | |
| creditValue | Int | must be > 0 (domain-enforced) |
| courseType | String | `CORE`/`ELECTIVE`/`PRACTICAL`/`CLINICAL` |
| departmentId/programmeId/levelId | String? FK | placement |
| semesterRank | Int? | which semester in the level |
| + standard cols | | SD |

### 3.5 Assessment & grading configuration

**AssessmentType** — catalog of component types (`key` UK e.g. `ca`,`exam`).
**AssessmentConfig** — a named weighted structure; `components` JSON
`[{key,label,weight,maxScore}]`, weights sum to 100 (domain-enforced);
`isDefault`. `name` UK.
**GradeScale** — a named scale; `bands` JSON
`[{minMark,maxMark,grade,gradePoint,isPass}]`, validated to span 0–100 with no
gaps/overlaps; `isDefault`. `name` UK.

### 3.6 Results

**Result**
| Column | Type | Notes |
|---|---|---|
| studentId | String FK→Student | |
| courseId | String FK→Course | |
| semesterId | String FK→Semester | |
| componentScores | String | JSON `[{key,score}]` |
| finalScore | Float? | computed 0–100 |
| grade | String? | resolved by GradeScale |
| gradePoint | Float? | resolved by GradeScale |
| creditsEarned | Int? | creditValue if pass else 0 |
| isLocked | Boolean | record lock; default false |
| **UK** | (studentId, courseId, semesterId) | no duplicate result |
| + standard cols | | SD |

### 3.7 Transcripts & templates

**TranscriptTemplate** — `name` UK, `version` (default 1), `layout` JSON
(ordered component definitions), `isDefault`. SD.
**Transcript** — `transcriptNumber` UK, `studentId` FK, `templateId` FK,
`type` (`RESULT_SLIP`/`ACADEMIC_TRANSCRIPT`/`STATEMENT`/`GRADUATION_REPORT`),
`snapshot` JSON (frozen rendered data), `verificationHash`, `status`
(`DRAFT`/`APPROVED`/`LOCKED`), `remarks?`, `generatedAt`. SD.

### 3.8 Audit, backup, notifications

**AuditLog** (immutable) — `userId?`, `action`, `entity`, `recordId?`,
`oldValue?` JSON, `newValue?` JSON, `ipAddress?`, `createdAt`. **No
`updatedAt`/`deletedAt`.**
**Backup** — `filePath`, `sizeBytes?`, `type` (`MANUAL`/`AUTOMATIC`/`SCHEDULED`),
`schedule?` (`DAILY`/`WEEKLY`/`MONTHLY`), `isCompressed`. SD.
**Notification** — `title`, `body?`, `level` (`INFO`/`WARNING`/`ERROR`),
`isRead`. SD.

---

## 4. Indexing strategy

Designed for 10,000+ students and 100,000+ results.

| Table      | Index                                      | Purpose                                                                   |
| ---------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| Result     | UK `(studentId, courseId, semesterId)`     | dedupe + fast lookup                                                      |
| Result     | `(studentId, semesterId)`                  | `findByStudentAndSemester` (hot path in `ProcessSemesterResults`) `[ADD]` |
| Result     | `(studentId)`                              | full academic history / CGPA `[ADD]`                                      |
| Result     | `(courseId, semesterId)`                   | course-wide processing/reporting `[ADD]`                                  |
| Result     | `(deletedAt)`                              | soft-delete filtering on large table `[ADD]`                              |
| Student    | UK `matricNumber`, UK `regNumber`          | identity lookups                                                          |
| Student    | `(departmentId)`, `(programmeId, levelId)` | cohort queries `[ADD]`                                                    |
| Course     | UK `code`; `(programmeId)`                 | registry lookups `[ADD]`                                                  |
| Semester   | UK `(sessionId, rank)`                     | calendar ordering                                                         |
| Transcript | UK `transcriptNumber`; `(studentId)`       | issuance/lookup `[ADD]`                                                   |
| AuditLog   | `(entity, recordId)`, `(createdAt)`        | audit queries `[ADD]`                                                     |

> `[ADD]` = recommended indexes to add in the Phase 1 migration; the current
> schema declares the unique constraints but not all secondary indexes. They are
> proposed here so Phase 1 implements them deliberately.

**Index discipline:** SQLite uses one index per query plan; composite indexes
are ordered left-to-right. Keep write-amplification in check on `Result`
(hot insert path during import) — add only the indexes above, measured against
the 100k-row import benchmark (see [implementation-plan.md](implementation-plan.md)).

---

## 5. Referential integrity

- FKs are declared via Prisma relations (§3). Enable SQLite `PRAGMA
foreign_keys = ON` at connection (Prisma does this by default).
- **On-delete:** application uses **soft delete**, so cascading hard deletes are
  not relied upon. Default Prisma referential action (`Restrict`/`NoAction` for
  required relations) is acceptable because rows are tombstoned, not removed.
  `[ASSUMPTION]` — no `onDelete: Cascade` is configured; confirm desired
  behaviour for genuine hard-purge maintenance jobs.

---

## 6. Soft delete vs uniqueness (important)

A `UNIQUE` column (e.g. `Course.code`) conflicts with soft delete: a tombstoned
row still occupies the unique value, blocking re-creation. Resolution options
(decide in Phase 1):

1. **Partial unique index** `WHERE deletedAt IS NULL` — preferred; SQLite
   supports partial indexes. Requires a raw-SQL migration since Prisma's
   `@unique` is unconditional. **Recommended.**
2. On soft-delete, mutate the unique value (e.g. append `:deleted:<ts>`) — ugly,
   avoided.

`[DECISION NEEDED]` Phase 1 should adopt option 1 via a custom migration for the
user-facing unique codes.

---

## 7. Enumerations (constrained strings)

| Field                      | Allowed values                                                 |
| -------------------------- | -------------------------------------------------------------- |
| `Institution.calendarType` | SEMESTER, TRIMESTER, QUARTER                                   |
| `Student.status`           | ACTIVE, SUSPENDED, DEFERRED, WITHDRAWN, GRADUATED              |
| `Course.courseType`        | CORE, ELECTIVE, PRACTICAL, CLINICAL                            |
| `Transcript.type`          | RESULT_SLIP, ACADEMIC_TRANSCRIPT, STATEMENT, GRADUATION_REPORT |
| `Transcript.status`        | DRAFT, APPROVED, LOCKED                                        |
| `Backup.type`              | MANUAL, AUTOMATIC, SCHEDULED                                   |
| `Backup.schedule`          | DAILY, WEEKLY, MONTHLY                                         |
| `Notification.level`       | INFO, WARNING, ERROR                                           |
| `AuditLog.action`          | CREATE, UPDATE, DELETE, LOGIN, EXPORT, PROCESS_SEMESTER, …     |

Enforced by Zod schemas + TypeScript union types ([coding-standards.md](coding-standards.md)).

---

## 8. Prisma migration strategy

1. **Schema is the source of truth.** Edits land in `prisma/schema.prisma`;
   migrations are generated, never hand-edited (except raw-SQL additions like
   partial unique indexes, §6).
2. **Workflow.**
   - Dev: `npx prisma migrate dev --name <change>` (creates a migration +
     applies it + regenerates client).
   - Prod/desktop: ship migration files; apply with `prisma migrate deploy` (or
     an embedded migration runner inside the Tauri app on first launch).
3. **Client generation needs network** to Prisma's binary host the first time
   (see `README.md` known gaps and [environment-setup.md](environment-setup.md));
   cache binaries for offline CI.
4. **Seed data.** A seed script provisions: default `Role`/`Permission` set, a
   default `GradeScale`, default `AssessmentConfig`, a `TranscriptTemplate`
   (Version 1), and the `Institution` row. Seeds are idempotent.
5. **Migration tests.** Each migration is validated by applying it to a throwaway
   DB in CI and running the integration suite ([coding-standards.md](coding-standards.md)).
6. **Backward data migrations** for JSON config columns: when a config shape
   changes, write a data migration that re-validates every row through the new
   value object.

---

## 9. Capacity & performance notes

- Target: 10k students × ~10 results/semester × 8 semesters ≈ 800k result rows
  over a programme lifetime; design for 100k+ active. SQLite handles this
  comfortably with the indexes in §4.
- **Bulk import** runs in batched transactions (e.g. 500–1000 rows/tx) to bound
  memory and keep the UI responsive (R-5 in the SAD).
- `VACUUM`/`ANALYZE` run as scheduled maintenance after large imports.

---

## 10. Open items for spec reconciliation

- `[ASSUMPTION]` Secondary indexes (§4 `[ADD]`) — confirm against real query
  patterns.
- `[DECISION NEEDED]` Partial unique indexes for soft-deleted rows (§6).
- `[ASSUMPTION]` On-delete behaviour for hard-purge jobs (§5).
- `[ASSUMPTION]` Whether `Student.facultyId` should become a real relation.

_Related: [erd.md](erd.md) · [solution-architecture.md](solution-architecture.md) ·
[implementation-plan.md](implementation-plan.md)_
