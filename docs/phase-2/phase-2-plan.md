# Phase 2 — Authentication & RBAC

**Project:** EARTMP · **Phase:** 2 · **Status:** Plan drafted, awaiting approval
to implement · **Predecessor:** Phase 1 (implemented)

> Deliverables-before-implementation spec, in the mandated format. Nothing is
> built until you approve. This plan incorporates the architecture-review
> decisions: **ADR-011** (fail-closed authorization + transactional use-cases),
> **F-16** (identity from session, never from caller args), **ADR-008**
> (DB-at-rest encryption groundwork), and Argon2id hashing.

---

## Executive Summary

Phase 2 delivers the **security backbone**: Argon2id password hashing, a login
flow that emits an authenticated **session**, and a **fail-closed authorization
seam** that every future use-case must pass through. It is built as
domain/application/infrastructure logic and **fully tested headless** (no DB, no
UI — same proof model as Phase 1). Concrete runtime persistence (Tauri SQL,
ADR-007) and the login **UI** are explicitly **deferred to their own phases**;
Phase 2 depends only on repository **ports** with in-memory fakes in tests.

This scoping is the key decision for your approval — see **§ Scope & sequencing**.

---

## Scope & sequencing (please confirm)

The original 20-phase sketch listed "UI screens (Login)" and implied persistence
in Phase 2, but **the React/Tauri shell and the Tauri-SQL runtime repositories
(ADR-007) do not exist yet**, and building them now would be building ahead.
Therefore Phase 2 is scoped as **auth logic only**:

| Concern                                          | Phase 2              | Deferred to       |
| ------------------------------------------------ | -------------------- | ----------------- |
| Argon2id hashing (`HashingPort` + impl)          | ✅ built + tested    | —                 |
| Login / session / change-password use-cases      | ✅ built + tested    | —                 |
| Fail-closed authorization seam (ADR-011)         | ✅ built + tested    | —                 |
| User/Role/Permission **ports** + in-memory fakes | ✅                   | —                 |
| **Concrete persistence** (Tauri SQL repos)       | ⛔                   | Phase 7 (ADR-007) |
| **Login UI / user-admin screens**                | ⛔                   | Shell phase       |
| Account lockout / rate-limit storage             | optional (see Risks) | Phase 2 or 17     |

**Recommendation:** approve auth-logic-only scope. Alternative if you prefer a
runnable end-to-end login now: I can add a **temporary Prisma-backed dev
repository** (Prisma already works from Phase 1) so login is demoable before the
Tauri shell — clearly marked as a dev-only adapter to be replaced in Phase 7.

---

## Objectives

1. Hash and verify passwords with **Argon2id** behind a `HashingPort`.
2. Authenticate a user and produce an authenticated **`SessionContext`** (actor
   id + effective permissions), updating `lastLoginAt` and writing a `LOGIN`
   audit entry.
3. Provide a **fail-closed authorization decorator** that wraps any use-case and
   **denies by default** unless the caller's session carries the declared
   permission(s).
4. Establish **identity-from-session** (F-16): use-cases receive the actor from
   the session, never from client-supplied arguments.
5. User/role administration use-cases (create user, deactivate, assign role,
   change password) — logic + tests.

**Out of scope:** UI screens, concrete DB persistence, multi-factor auth, network
auth (offline-first), password-reset email (no network).

---

## Deliverables

| #   | Deliverable                                                                                                                      | Layer            |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| D1  | `User`, `Role`, `Permission` domain types + invariants (e.g. user must have a role; permission keys are typed)                   | domain           |
| D2  | `HashingPort` interface + `Argon2HashingService` impl (Argon2id, tuned params)                                                   | app port + infra |
| D3  | `SessionContext` value object (actorId, roleName, `Set<permissionKey>`, `has(permission)`)                                       | domain           |
| D4  | Repository ports: `UserRepository`, `RoleRepository`, `PermissionRepository` (incl. `findByUsername`, role+permission hydration) | domain           |
| D5  | `AuthenticateUser` use-case (verify hash, build session, audit `LOGIN`, generic failure, fail-closed)                            | application      |
| D6  | `ChangePassword` use-case (verify old, re-hash, audit)                                                                           | application      |
| D7  | `ManageUsers` use-cases: `CreateUser`, `DeactivateUser`, `AssignRole`                                                            | application      |
| D8  | **`Authorize` decorator / `requirePermission` guard** — fail-closed wrapper for use-cases (ADR-011)                              | application      |
| D9  | `ClockPort` wired (from Phase 1) for `lastLoginAt`/audit timestamps; in-memory fakes for all ports                               | app/infra (test) |
| D10 | Unit/integration tests (≥80% coverage on new domain+application code)                                                            | tests            |
| D11 | `/docs` update + implementation notes                                                                                            | docs             |
| D12 | _(Optional, on your call)_ temporary Prisma-backed dev repositories for end-to-end login demo                                    | infra (dev-only) |

---

## Architecture Decisions

- **AD2.1 — Authorization is fail-closed and unskippable (ADR-011).** A use-case
  declares `requiredPermissions`; the `Authorize` wrapper checks the
  `SessionContext` and throws `AuthorizationError` if any is missing. A use-case
  with **no** declared permissions is treated as **deny** unless explicitly
  marked `public` (e.g. login itself). Default = deny.
- **AD2.2 — Identity from session, never from args (F-16).** Use-case inputs
  carry data, not `userId`/role; the actor comes from the injected
  `SessionContext`. Prevents webview privilege escalation later.
- **AD2.3 — Argon2id parameters are configurable** (memory, iterations,
  parallelism) via `Setting`, so cost can be raised over time. Defaults
  `[ASSUMPTION]`: 19 MiB / t=3 / p=1 — benchmarked before lock-in.
- **AD2.4 — Hashing is a port; runtime impl may move to Rust.** The Node Argon2
  impl serves dev/test now; under ADR-007 the production impl may be the Tauri/
  Rust Argon2 — same `HashingPort`, swapped at the composition root.
- **AD2.5 — Sessions are in-core, single-operator.** No network tokens; a
  `SessionContext` lives in the app process; idle auto-lock re-auth is a UI-phase
  concern but the session model supports it.
- **AD2.6 — Encryption groundwork (ADR-008).** Phase 2 introduces the
  passphrase→key derivation (Argon2id KDF) interface that both DB-at-rest
  encryption and backup encryption will use; the actual SQLCipher wiring lands
  with the Tauri-SQL data layer (Phase 7) but the key-derivation port is defined
  here.

---

## Database Changes

- **None to the schema shape** — `User`, `Role`, `Permission`, `RolePermission`
  already exist and are seeded (Phase 1).
- **Possible additive (decision):** a small `LoginAttempt` table or
  `User.failedAttempts`/`lockedUntil` columns for lockout. _Recommendation:_
  defer to keep Phase 2 schema-stable; fold lockout into the **pre-Phase-5
  bundled migration** (ADR-010) or Phase 17. Flag if you want it now.

---

## UI Screens

**None in Phase 2** (deferred to the shell phase). Screens that will consume
these use-cases later: Login, Change Password, User & Role administration. They
are listed here only so the use-case I/O contracts are designed UI-ready.

---

## Services / Use-cases (contracts)

- `Argon2HashingService implements HashingPort { hash(plain): Promise<string>; verify(plain, hash): Promise<boolean> }`
- `AuthenticateUser.execute({ username, password }): Promise<SessionContext>` — public; generic failure; audits LOGIN.
- `ChangePassword.execute({ oldPassword, newPassword }, session): Promise<void>` — requires authenticated session.
- `CreateUser.execute({ username, email, fullName, roleId, tempPassword }, session)` — requires `users.create`.
- `DeactivateUser` / `AssignRole` — require `users.update` / `roles.assign`.
- `Authorize(useCase, requiredPermissions[])` — wraps execute; fail-closed.

---

## Validation Rules

- Username/email unique (DB) + Zod-validated shape; password policy (min length,
  complexity) from `Setting`, `[ASSUMPTION]` defaults TBD.
- No plaintext password logged, returned, or stored; only Argon2id hashes.
- Login failure is generic (no user enumeration); attempts are rate-limited
  (in-memory for v1 unless lockout storage is approved).
- Authorization denies by default; every state-changing use-case audits.

---

## Test Plan

| Test                       | Asserts                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Argon2 hash/verify         | correct password verifies; wrong fails; hash ≠ plaintext; unique salts                                                |
| `AuthenticateUser` success | returns session with correct permission set; `lastLoginAt` set; `LOGIN` audited                                       |
| `AuthenticateUser` failure | generic error; no session; inactive/deleted user rejected                                                             |
| `Authorize` fail-closed    | use-case with missing permission throws `AuthorizationError`; with permission proceeds; no-permission-declared ⇒ deny |
| identity-from-session      | use-case ignores any caller-supplied actor id; uses session actor                                                     |
| `ChangePassword`           | old-password check; re-hash; audit; rejects wrong old password                                                        |
| `ManageUsers`              | permission-gated; role assignment hydrates permissions; deactivation blocks login                                     |
| coverage                   | ≥80% on new domain+application code (CI gate)                                                                         |

All tests run **headless** against in-memory fakes — no DB, no UI — preserving
the Phase 1 architecture proof. The architecture fitness test continues to guard
boundaries (auth domain imports no framework).

---

## Risks

| ID   | Risk                                                     | Mitigation                                                                                                                             |
| ---- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| P2-a | Argon2 native binding in Node vs Rust runtime divergence | port-based; pick a portable impl for dev (`@node-rs/argon2`), document the Rust runtime swap (AD2.4)                                   |
| P2-b | Authorization seam bypassed by a future use-case author  | make `Authorize` the only registration path in the DI container; an architecture test asserts every state-changing use-case is wrapped |
| P2-c | Lockout/rate-limit without persistence is process-local  | acceptable for single-operator v1; durable lockout deferred (decision)                                                                 |
| P2-d | Argon2 params too weak/strong for target hardware        | params in `Setting`; benchmark before launch                                                                                           |
| P2-e | Building UI/persistence ahead of their phases            | explicitly deferred; Phase 2 stays headless                                                                                            |

---

## Completion Criteria

- [ ] All deliverables (D1–D11) exist; D12 only if you approve the dev-repo option.
- [ ] Tests pass; coverage ≥80% on new code; `tsc` strict clean; lint/format clean.
- [ ] Architecture boundaries intact (fitness test green; auth domain framework-free).
- [ ] Fail-closed authorization demonstrably rejects missing-permission calls.
- [ ] No UI, no concrete persistence (unless D12 dev-repo explicitly approved).
- [ ] `/docs` updated; summary posted; **approval requested before Phase 3.**

---

## Approval Checklist (to start Phase 2 implementation)

- [ ] **Scope confirmed:** auth-logic-only, UI + Tauri-SQL persistence deferred.
- [ ] **D12 decision:** add the temporary Prisma dev-repository for a runnable
      login demo, or stay fully headless?
- [ ] **Lockout decision:** defer durable lockout (recommended) or add storage now?
- [ ] Argon2id default params acceptable as a starting point.
- [ ] Go-ahead to write Phase 2 implementation code.

_Related: [architecture-review.md](../phase-0/architecture-review.md) (ADR-008/011) ·
[security-architecture.md](../phase-0/security-architecture.md) ·
[phase-1 implementation notes](../phase-1/implementation-notes.md)_
