# Phase 19 — Audit & Observability

**Project:** EARTMP · **Phase:** 19 · **Status:** Plan drafted, awaiting approval
to implement · **Predecessor:** Phase 18 (implemented)

> Deliverables-before-implementation spec, in the mandated format. Nothing is
> built until you approve. Logic only; log shipping / external SIEM is a shell /
> ops concern. Same proof model: headless, ≥80% coverage, dev Prisma adapter,
> runnable demo.

---

## Executive Summary

Every privileged action across the app already writes an audit entry (auth,
results, transcripts, graduation, backup, security…). Phase 19 makes that trail
**reviewable and trustworthy**: a **queryable** audit use-case (filter by actor /
entity / action / date, paginated) and a **tamper-evident hash chain** — each
append-only entry stores a SHA-256 link over the previous hash + its own content,
so any edit, deletion, or reordering breaks the chain and a **`VerifyAuditChain`**
use-case pinpoints the first broken link. A **structured, secret-redacting
`LoggerPort`** rounds out observability without ever logging key material.

---

## Scope & sequencing

| Concern                                        | Phase 19          | Deferred to |
| ---------------------------------------------- | ----------------- | ----------- |
| Queryable audit log (filters + pagination)     | ✅ built + tested | —           |
| Tamper-evident hash chain (write + verify)     | ✅                | —           |
| `VerifyAuditChain` (find first broken link)    | ✅                | —           |
| Structured, redacting `LoggerPort` + JSON impl | ✅                | —           |
| Schema: add `hash` / `prevHash` to AuditLog    | ✅ (migration)    | —           |
| Log shipping / external SIEM / dashboards      | ⛔                | Shell / ops |
| UI (audit viewer)                              | ⛔                | Shell phase |

---

## Objectives

1. **`GetAuditLog`** (`audit.read`) — query the trail by `actorId`, `entity`,
   `action`, and `createdAt` range; paginated (`Page<AuditEntry>`).
2. **Tamper-evident chain** — extend the audit write path so each entry stores
   `hash = SHA-256(prevHash + canonicalPayload(entry))` and `prevHash`. Pure
   canonical-payload builder in the domain; the SHA-256 behind an `AuditHasher`
   port (infra impl).
3. **`VerifyAuditChain`** (`audit.read`) — walk entries in order, recompute each
   link, and report `{ valid, entries, brokenAt? }` (the id/index of the first
   mismatch or linkage break).
4. **`LoggerPort`** — structured levels (`info`/`warn`/`error`) + context; a JSON
   console impl; a **redaction** layer that strips secret-ish keys
   (passphrase/privateKey/sealed/token) so observability never leaks secrets.

**Out of scope:** log shipping, dashboards, UI.

---

## Deliverables

| #   | Deliverable                                                                                                      | Layer          |
| --- | ---------------------------------------------------------------------------------------------------------------- | -------------- |
| D1  | Schema: `hash String?` + `prevHash String?` on `AuditLog` (+ migration)                                          | prisma         |
| D2  | `canonicalAuditPayload(entry)` (pure) + `AuditEntry`/`AuditQuery` types                                          | domain         |
| D3  | `AuditHasher` port + `Sha256Hasher` (infra); chained write in `PrismaAuditLogAdapter`                            | port + infra   |
| D4  | `AuditLogQueryRepository` port + dev Prisma impl (filter + paginate + ordered scan)                              | domain + infra |
| D5  | `GetAuditLog` use-case (`audit.read`)                                                                            | application    |
| D6  | `VerifyAuditChain` use-case (`audit.read`) — first-broken-link report                                            | application    |
| D7  | `LoggerPort` + `JsonLogger` (infra) + redaction helper                                                           | port + infra   |
| D8  | `scripts/demo-audit.ts` — generate entries, query/filter, verify chain ✓, tamper a row → verify pinpoints it     | scripts (dev)  |
| D9  | Tests (≥80%) — canonical/chain hashing, verify (clean + broken + reordered), query filters/pagination, redaction | tests          |
| D10 | `/docs` update + implementation notes                                                                            | docs           |

---

## Architecture Decisions

- **AD19.1 — Append-only + hash-chained.** `AuditLog` already has no
  update/delete (immutable). The chain makes immutability **provable**: tampering
  with or removing any row breaks every subsequent link.
- **AD19.2 — Hash over app-controlled content.** The link covers `prevHash` + a
  **canonical payload** (actor/action/entity/recordId/old/new/createdAt) built by
  a pure domain function; the SHA-256 is an `AuditHasher` port, so the chain logic
  is testable without a DB and the algorithm is swappable.
- **AD19.3 — Verify is independent.** `VerifyAuditChain` recomputes the whole
  chain from raw fields — it never trusts the stored hash except to compare,
  reporting the **first** broken link so an investigator knows where tampering
  began.
- **AD19.4 — Redaction by construction.** The logger drops/obscures secret-ish
  keys before output (passphrase/privateKey/sealed/token/salt); a test asserts no
  secret leaks. Aligns with the Phase 18 audit-redaction guard.
- **AD19.5 — Chaining is serialized.** The write reads the latest hash then
  appends; single-operator v1 makes this race-free. (Concurrent multi-writer
  ordering is a shell/DB-sequence concern, noted.)

---

## Database Changes

- **`AuditLog`** gains `hash String?` and `prevHash String?` (nullable, so
  pre-chain rows verify as "ungenerated" rather than failing). Append-only
  preserved. Migration authored.
- **Seed:** none (`audit.read` already seeded).

---

## UI Screens

**None in Phase 19.** Future consumer (deferred): an audit viewer with filters +
an integrity badge.

---

## Services / Use-cases (contracts, abridged)

- `canonicalAuditPayload(entry): string` (pure)
- `AuditHasher.hash(data: string): string`
- `GetAuditLog.execute({ where?, skip?, take? }, session): Page<AuditEntry>` → `audit.read`
- `VerifyAuditChain.execute({}, session): { valid; checked; brokenAt? }` → `audit.read`
- `LoggerPort.info|warn|error(message, context?)`

---

## Validation Rules

- Query: `take` bounded (e.g. ≤200); date range validated; results ordered by
  `createdAt` then `id`.
- Chain write: `prevHash` = the latest entry's `hash` (or null for the first);
  `hash` deterministic over the canonical payload.
- Verify: a recomputed hash ≠ stored, or a `prevHash` that doesn't match the
  predecessor's `hash`, marks the first broken link.
- Both use-cases authorized (`audit.read`, fail-closed). The logger never emits
  redacted keys.

---

## Test Plan

| Test               | Asserts                                                                 |
| ------------------ | ----------------------------------------------------------------------- |
| canonical payload  | deterministic + order-stable for the same entry                         |
| chain write/verify | a clean chain verifies; `brokenAt` is null                              |
| tamper detection   | editing one entry's content → verify flags that entry as first break    |
| deletion/reorder   | removing/reordering a row breaks the chain at the gap                   |
| query              | filter by actor/entity/action/date; pagination (`total`, `skip`/`take`) |
| redaction          | secret-ish keys never appear in logger output                           |
| authz              | `GetAuditLog` + `VerifyAuditChain` gated by `audit.read`                |
| coverage           | ≥80% on new code                                                        |

---

## Risks

| ID    | Risk                                      | Mitigation                                                                 |
| ----- | ----------------------------------------- | -------------------------------------------------------------------------- |
| P19-a | Concurrent writes race the prevHash read  | single-operator v1 serialized (AD19.5); DB sequence in the shell           |
| P19-b | Existing pre-chain rows fail verify       | nullable hash → treated as "unchained", not broken (AD19.1)                |
| P19-c | Canonical payload drift breaks old hashes | payload is versioned/pinned; a test locks the field order                  |
| P19-d | Secrets leaking into logs                 | redaction-by-construction + a test (AD19.4)                                |
| P19-e | Large trail scan for verify               | acceptable headless; chunked/anchored verify is a later refinement (noted) |

---

## Completion Criteria

- [ ] Queryable audit use-case + hash-chained write + `VerifyAuditChain` +
      redacting `LoggerPort` built, gated, tested.
- [ ] `demo:audit` queries/filters, verifies a clean chain, and **pinpoints** a
      tampered row.
- [ ] Tests pass; coverage ≥80% on new code; `tsc` strict clean; lint/format clean.
- [ ] Boundaries intact (canonical payload pure; use-cases free of crypto; fitness
      test green).
- [ ] `/docs` updated; summary posted; **approval requested before Phase 20.**

---

## Approval Checklist (to start Phase 19 implementation)

- [ ] Scope confirmed: queryable audit + tamper-evident chain + structured logger, logic only.
- [ ] Schema: add nullable **`hash` / `prevHash`** to `AuditLog` (migration) — OK?
- [ ] Chain = **SHA-256 over prevHash + canonical payload**, computed on write, verified independently — OK?
- [ ] Query filters: actor / entity / action / date range + pagination — OK?
- [ ] **Redacting `LoggerPort`** (contract + JSON impl), no secrets logged — OK?
- [ ] Go-ahead to implement.

_Related: `src/domain/repositories/index.ts` (AuditLogPort) ·
`src/infrastructure/repositories/PrismaAuthRepositories.ts` (PrismaAuditLogAdapter) ·
[phase-18 implementation notes](../phase-18/implementation-notes.md) (redaction) ·
[security-architecture.md](../phase-0/security-architecture.md)_
