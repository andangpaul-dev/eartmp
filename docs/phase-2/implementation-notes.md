# Phase 2 — Implementation Notes & Verification

**Status:** Implemented. All gates green. **Awaiting approval to start Phase 3.**

Scope approved: auth-logic-only + the temporary Prisma dev-repository for a
runnable demo + lockout deferred.

---

## Verification evidence (commands run)

| Gate                | Command                 | Result                                                                               |
| ------------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| Type-check          | `npm run typecheck`     | **clean**                                                                            |
| Lint (+ boundaries) | `npm run lint`          | **0 errors**                                                                         |
| Format              | `npm run format:check`  | **conforms**                                                                         |
| Tests               | `npm run test:coverage` | **76 passed**; stmts **98.7%** · branch **97.9%** · funcs **100%** (auth files 100%) |
| Argon2 (real)       | part of suite           | hashes `$argon2id$`, verifies, salts, never throws                                   |
| End-to-end login    | `npm run demo:login`    | ✓ login, ✓ wrong-password rejected, ✓ fail-closed authz denial, ✓ LOGIN audited      |

The demo runs the real Argon2id hasher + Prisma dev repos against the seeded
`prisma/dev.db` (admin / `ChangeMe123!`). Repeated runs show the audit log
accumulating LOGIN entries (append-only working).

---

## What was built

**Domain** (`src/domain/`)

- `entities/auth.ts` — `Permission`, `Role`, `UserAccount`, `UserRules`,
  `rolePermissionKeys`.
- `value-objects/SessionContext.ts` — immutable actor + permission set;
  `has`/`hasAll`/`anonymous()`. Identity source of truth (F-16).
- `errors/auth.ts` — `AuthenticationError` (generic, no enumeration),
  `AuthorizationError`.
- `repositories/auth.ts` — `UserRepository`, `RoleRepository`,
  `PermissionRepository` ports.

**Application** (`src/application/`)

- `ports/HashingPort.ts`, `ports/KeyDerivationPort.ts` (ADR-008 groundwork).
- `authorization/AuthorizedUseCase.ts` — the **fail-closed seam**: `authorize()`
  denies by default; allows only `isPublic`, `authenticatedOnly`, or all declared
  `requiredPermissions`.
- `use-cases/auth/` — `AuthenticateUser` (public), `ChangePassword`
  (authenticatedOnly, self-only), `CreateUser` / `DeactivateUser` / `AssignRole`
  (permission-gated). Each audits its write.

**Infrastructure** (`src/infrastructure/`)

- `crypto/Argon2HashingService.ts` (Argon2id, injectable params, default ~19 MiB
  / t=3 / p=1), `crypto/Argon2KeyDerivationService.ts` (ADR-008).
- `repositories/PrismaAuthRepositories.ts` — **dev-only** Prisma adapters
  (`PrismaUserRepository`, `PrismaRoleRepository`, `PrismaPermissionRepository`,
  `PrismaAuditLogAdapter`); replaced by the Tauri-SQL data layer in Phase 7
  (ADR-007).

**Seed / scripts**

- Seed adds user/role-management permissions (`users.*`, `roles.*`) and a default
  `admin` SUPER_ADMIN user (Argon2-hashed; password set only on create →
  idempotent).
- `scripts/demo-login.ts` (`npm run demo:login`) — the end-to-end demo.

**Tests** (`tests/auth/`) — 47 new assertions across SessionContext, the
authorization seam (every branch), AuthenticateUser, ChangePassword, ManageUsers,
and real Argon2; all headless against in-memory fakes (`tests/auth/fakes.ts`),
preserving the architecture proof.

---

## Decisions honoured / deviations

- **No UI, no runtime (Tauri-SQL) persistence** — deferred to their phases, as
  approved. The Prisma adapters are explicitly dev-only.
- **Lockout deferred** — `LoginAttempt`/`lockedUntil` not added; rate-limiting is
  process-local for v1. Folds into the pre-Phase-5 bundle or Phase 17.
- **Argon2 via `@node-rs/argon2`** (portable prebuilt bindings, argon2id) for
  dev/test; production may swap to a Rust impl behind `HashingPort` (AD2.4).
- `scripts/` is run via `tsx` and is outside the `tsc` include set (dev tooling);
  it is linted and Prettier-formatted, and proven by actually running.

---

## Definition of Done (CLAUDE.md)

- [x] Deliverables D1–D11 exist (+ D12 dev-repo, approved).
- [x] Tests pass (76); coverage ≥80% (98.7%).
- [x] `tsc` strict clean; lint/format clean.
- [x] Boundaries intact (auth domain/app import no framework; fitness test green).
- [x] Fail-closed authorization demonstrably rejects missing-permission calls.
- [x] `/docs` updated; summary posted; approval requested before Phase 3.

_Next: Phase 3 — Institution & Settings (only on your approval)._
