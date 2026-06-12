# Phase 18 — Security Hardening

**Status:** **IMPLEMENTED** (plan approved in chat, 2026-06-12). All gates green
(257 tests, security + transcript demos working). **Awaiting approval to start
Phase 19.**

## Documents

| Doc                                                | Purpose                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| [phase-18-plan.md](phase-18-plan.md)               | Full Phase 18 spec in the mandated format (Objectives → Completion). |
| [implementation-notes.md](implementation-notes.md) | What was built, verification evidence, ADR-008 status.               |

## Goal in one line

**Encrypt secrets at rest** — seal the transcript-signing private key with the
operator passphrase (closing the Phase 12 plaintext-key note), add a re-seal /
passphrase-change path, and **finalize ADR-008** (DB-at-rest via SQLCipher, wired
in the shell).
