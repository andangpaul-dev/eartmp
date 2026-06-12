# Phase 17 — Backup & Restore

**Status:** **IMPLEMENTED** (plan approved in chat, 2026-06-12). All gates green
(246 tests, backup demo working). **Awaiting approval to start Phase 18.**

## Documents

| Doc                                                | Purpose                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| [phase-17-plan.md](phase-17-plan.md)               | Full Phase 17 spec in the mandated format (Objectives → Completion). |
| [implementation-notes.md](implementation-notes.md) | What was built, verification evidence, decisions honoured.           |

## Goal in one line

Export an **encrypted, integrity-protected backup** (AES-256-GCM, key from the
operator passphrase) and **restore** it — atomically and only after verifying
integrity — so a tampered or wrong-passphrase backup can never corrupt the data.
