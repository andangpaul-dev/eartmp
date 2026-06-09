# Phase 3 — Institution & Settings

**Project:** EARTMP · **Phase:** 3 · **Status:** Plan drafted, awaiting approval
to implement · **Predecessor:** Phase 2 (implemented)

> Deliverables-before-implementation spec, in the mandated format. Nothing is
> built until you approve. Same proof model as Phases 1–2: headless
> domain/application logic, ≥80% coverage, dev-only Prisma adapter for a runnable
> demo; UI and runtime (Tauri-SQL) persistence deferred to their phases.

---

## Executive Summary

Phase 3 makes the **institution identity** and a **typed settings store**
runtime-configurable. Every later phase reads this: transcript branding
(logo/seal/registrar signature, name, motto, accreditation no.), the calendar
type, the transcript-number rule, grading/security defaults, and the
encryption salt (ADR-008). The deliverable is the **logic + validation** for
reading and writing these, with a **schema-versioned, validated** settings
registry (closing F-25), authorized through the Phase 2 fail-closed seam.

---

## Scope & sequencing

Consistent with Phases 1–2: build **logic only**, tested headless.

| Concern                                               | Phase 3           | Deferred to       |
| ----------------------------------------------------- | ----------------- | ----------------- |
| `Institution` profile read/update use-cases           | ✅ built + tested | —                 |
| Typed **SettingsRegistry** (validated, versioned)     | ✅ built + tested | —                 |
| `GetSetting`/`SetSetting`/`ListSettings` use-cases    | ✅ built + tested | —                 |
| Branding **paths** stored on `Institution`            | ✅ (paths only)   | —                 |
| Actual **file upload/storage** of logo/seal/signature | ⛔                | Shell phase       |
| Concrete **Tauri-SQL** persistence                    | ⛔                | Phase 7 (ADR-007) |
| Settings **admin UI**                                 | ⛔                | Shell phase       |

---

## Objectives

1. Read and update the singleton **`Institution`** profile (branding metadata +
   `calendarType` + `transcriptNumberRule`), authorized + audited.
2. A **typed settings registry**: each known setting has a key, a default, a
   **`schemaVersion`**, and a **validator** (F-25). Unknown keys and invalid
   values are rejected on write; values are validated on read.
3. `GetSetting` / `SetSetting` / `ListSettings` use-cases, permission-gated and
   audited (before/after captured).
4. Seed the **default settings** (password policy, Argon2 params reference,
   grading/transcript defaults) and the institution row (already seeded).

**Out of scope:** UI, file storage, network, the actual encryption wiring (only
the salt setting is introduced; SQLCipher lands in Phase 7).

---

## Deliverables

| #   | Deliverable                                                                                                                                                               | Layer         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| D1  | `Institution` domain type + invariants (singleton; calendarType ∈ enum)                                                                                                   | domain        |
| D2  | `SettingDefinition<T>` + **`SettingsRegistry`** (key, default, schemaVersion, `parse/validate`)                                                                           | domain        |
| D3  | Initial registry entries: `security.passwordPolicy`, `security.argon2Params`, `grading.defaultScaleName`, `transcript.numberRule`, `institution.encryptionSalt` (ADR-008) | domain        |
| D4  | Ports: `InstitutionRepository`, `SettingRepository`                                                                                                                       | domain        |
| D5  | `GetInstitution` / `UpdateInstitution` use-cases (permission-gated, audited)                                                                                              | application   |
| D6  | `GetSetting` / `SetSetting` / `ListSettings` use-cases (validate via registry, audited)                                                                                   | application   |
| D7  | Dev-only `PrismaInstitutionRepository`, `PrismaSettingRepository`                                                                                                         | infra (dev)   |
| D8  | Seed: `institution.manage`, `settings.read`, `settings.manage` permissions + default settings rows                                                                        | seed          |
| D9  | `scripts/demo-settings.ts` — runnable read/update/validate demo                                                                                                           | scripts (dev) |
| D10 | Tests (≥80% coverage on new domain+application code)                                                                                                                      | tests         |
| D11 | `/docs` update + implementation notes                                                                                                                                     | docs          |

---

## Architecture Decisions

- **AD3.1 — Settings are typed and validated through a registry, not raw JSON
  (closes F-25).** Each setting declares a `schemaVersion` and a validator; a
  write that fails validation is rejected, and a read migrates/validates the
  stored blob. No code reads `Setting.value` as untyped JSON directly.
- **AD3.2 — `Institution` is a singleton** (one row). Use-cases operate on "the
  institution"; the repository resolves the single row.
- **AD3.3 — Branding is paths + metadata only in Phase 3.** File bytes are a
  shell concern; storing a path keeps the domain pure and testable.
- **AD3.4 — Encryption salt as a setting (ADR-008 groundwork).** The
  `institution.encryptionSalt` setting is generated once and stored; the
  `KeyDerivationPort` (Phase 2) consumes it when SQLCipher wiring lands (Phase 7).
  _Decision: confirm we store the salt (not the key) — the key is never
  persisted._
- **AD3.5 — Writes are authorized + audited** via the Phase 2 seam
  (`settings.manage` / `institution.manage`).

---

## Database Changes

- **None to the schema shape** — `Institution` and `Setting` exist (Phase 1).
- **Seed additions:** three permissions (`institution.manage`, `settings.read`,
  `settings.manage`) granted to SUPER_ADMIN (+ `settings.read` to REGISTRAR),
  and default `Setting` rows (idempotent upserts by key).
- No lockout/version columns here (those remain in the pre-Phase-5 bundle,
  ADR-010).

---

## UI Screens

**None in Phase 3.** Future consumers (deferred): Institution profile editor,
Settings admin, branding-asset uploader. Use-case I/O is designed UI-ready.

---

## Services / Use-cases (contracts)

- `GetInstitution.execute({}, session): Promise<Institution>` — `institution.manage` or read perm.
- `UpdateInstitution.execute({ patch }, session): Promise<Institution>` — `institution.manage`; audits old→new.
- `GetSetting.execute({ key }, session): Promise<T>` — `settings.read`; validates on read.
- `SetSetting.execute({ key, value }, session): Promise<void>` — `settings.manage`; validates via registry; audits old→new.
- `ListSettings.execute({}, session): Promise<SettingView[]>` — `settings.read`.

---

## Validation Rules

- Setting writes validated against the registry definition (type + schemaVersion);
  unknown key ⇒ reject; invalid value ⇒ reject with a clear message.
- `Institution.calendarType` ∈ {SEMESTER, TRIMESTER, QUARTER}.
- Branding paths are strings; existence/file checks deferred to the shell.
- All writes authorized (fail-closed) and audited.

---

## Test Plan

| Test                  | Asserts                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| SettingsRegistry      | known setting parses/validates; invalid value rejected; unknown key rejected; default returned when unset; schemaVersion surfaced |
| Get/SetSetting        | round-trip via fake repo; write audits old→new; validation enforced; permission-gated through the seam                            |
| ListSettings          | returns known settings with values/defaults                                                                                       |
| Get/UpdateInstitution | patch applies; calendarType enum enforced; audit old→new; permission-gated                                                        |
| coverage              | ≥80% on new domain+application code                                                                                               |

All headless against in-memory fakes (extending `tests/auth/fakes.ts` style).

---

## Risks

| ID   | Risk                                         | Mitigation                                                                   |
| ---- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| P3-a | Settings schema evolves later                | `schemaVersion` per setting + validate/migrate on read (AD3.1)               |
| P3-b | Storing the encryption salt vs key confusion | store **salt** only; key derived at runtime, never persisted (AD3.4)         |
| P3-c | Domain pulling a validation framework (Zod)  | keep validators as plain functions in the registry; Zod stays at the UI edge |
| P3-d | Branding file handling creeping in           | paths only in Phase 3; explicit deferral                                     |

---

## Completion Criteria

- [ ] D1–D11 exist; demo (`demo:settings`) runs read/update/validate end-to-end.
- [ ] Tests pass; coverage ≥80% on new code; `tsc` strict clean; lint/format clean.
- [ ] Architecture boundaries intact (fitness test green).
- [ ] Settings writes are validated, authorized, and audited.
- [ ] No UI, no file storage, no Tauri-SQL persistence.
- [ ] `/docs` updated; summary posted; **approval requested before Phase 4.**

---

## Approval Checklist (to start Phase 3 implementation)

- [ ] Scope confirmed: institution + settings **logic only**, UI/file/persistence deferred.
- [ ] Initial settings registry entries (D3) acceptable, or adjust the list.
- [ ] AD3.4 confirmed: store the encryption **salt** as a setting now (key never persisted).
- [ ] Go-ahead to write Phase 3 implementation code.

_Related: [architecture-review.md](../phase-0/architecture-review.md) (F-25, ADR-008) ·
[database-design.md](../phase-0/database-design.md) ·
[phase-2 implementation notes](../phase-2/implementation-notes.md)_
