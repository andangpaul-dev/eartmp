# Phase 3 — Implementation Notes & Verification

**Status:** Implemented. All gates green. **Awaiting approval to start Phase 4.**

Scope approved: institution + settings **logic only**; defaults list as proposed;
store the encryption **salt** (key never persisted).

---

## Verification evidence (commands run)

| Gate                | Command                 | Result                                                                                                               |
| ------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Type-check          | `npm run typecheck`     | **clean**                                                                                                            |
| Lint (+ boundaries) | `npm run lint`          | **0 errors**                                                                                                         |
| Format              | `npm run format:check`  | **conforms**                                                                                                         |
| Tests               | `npm run test:coverage` | **97 passed**; stmts **98.3%** · branch **96.6%** · funcs **97.3%**                                                  |
| Seed idempotency    | `npm run db:seed`       | stable; settings created once; salt generated once                                                                   |
| End-to-end demo     | `npm run demo:settings` | ✓ read default · ✓ validated write · ✓ invalid write rejected · ✓ fail-closed denial · ✓ institution update · ✓ list |

New code coverage: config use-cases 96–99%, `SettingsRegistry` 97%, and the
`institution.ts` / `config.ts` error files 100%.

---

## What was built

**Domain** (`src/domain/`)

- `entities/institution.ts` — `Institution`, `CalendarType`, `InstitutionRules`.
- `settings/SettingsRegistry.ts` — `SettingDefinition<T>`, `SettingsRegistry`
  (typed, **schema-versioned** envelopes, validate on read/write), plain-function
  validators (no framework), and `buildDefaultRegistry()` with the 5 settings.
- `errors/config.ts` — `SettingsError`, `InstitutionError`.
- `repositories/config.ts` — `InstitutionRepository`, `SettingRepository` ports.

**Application** (`src/application/use-cases/config/`)

- `ManageInstitution.ts` — `GetInstitution` (`settings.read`), `UpdateInstitution`
  (`institution.manage`, validates calendarType, audits old→new).
- `ManageSettings.ts` — `GetSetting`/`ListSettings` (`settings.read`), `SetSetting`
  (`settings.manage`, validates via registry, audits old→new). All through the
  Phase 2 fail-closed seam.

**Infrastructure** — dev-only `PrismaInstitutionRepository`,
`PrismaSettingRepository` (ADR-007; replaced by Tauri-SQL in Phase 7).

**Seed / scripts** — adds `institution.manage`, `settings.read`,
`settings.manage` permissions (+ `settings.read` to REGISTRAR); seeds the 5
default settings as validated envelopes (encryption salt generated once via
`crypto.randomBytes`, idempotent). `scripts/demo-settings.ts`
(`npm run demo:settings`).

**Tests** (`tests/config/`) — registry validation/round-trip/corruption, the
three settings use-cases (incl. authz denial + audit), and institution get/update
(enum enforcement + authz). Headless against in-memory fakes.

---

## Decisions honoured

- **F-25 closed:** settings are typed + validated + schema-versioned; no code
  reads `Setting.value` as raw JSON (AD3.1).
- **Institution singleton** (AD3.2); **branding = paths only** (AD3.3) — file
  storage deferred to the shell.
- **Encryption salt stored, key never persisted** (AD3.4, ADR-008 groundwork);
  `KeyDerivationPort` consumes it when SQLCipher lands in Phase 7.
- No UI, no Tauri-SQL persistence (dev Prisma adapter only); no schema changes
  (those stay in the pre-Phase-5 bundle, ADR-010).

---

## Definition of Done (CLAUDE.md)

- [x] Deliverables D1–D11 exist; `demo:settings` runs end-to-end.
- [x] Tests pass (97); coverage ≥80% (98.3%).
- [x] `tsc` strict clean; lint/format clean.
- [x] Boundaries intact (config domain/app import no framework; fitness test green).
- [x] Settings writes validated, authorized, audited.
- [x] `/docs` updated; summary posted; approval requested before Phase 4.

_Next: Phase 4 — Domain Engines (GradeScale, AssessmentStructure, GpaEngine),
adapting the reference implementation against the approved design._
