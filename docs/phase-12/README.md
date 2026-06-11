# Phase 12 — Transcript Engine

**Status:** **IMPLEMENTED** (plan approved in chat, 2026-06-09). All gates green
(200 tests, coverage 93.8%, transcript demo working incl. tamper-fails-verify).
**Awaiting approval to start Phase 13.**

## Documents

| Doc                                                | Purpose                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| [phase-12-plan.md](phase-12-plan.md)               | Full Phase 12 spec in the mandated format (Objectives → Completion). |
| [implementation-notes.md](implementation-notes.md) | What was built, verification evidence, decisions honoured.           |

## Goal in one line

Assemble a student's **transcript data**, **bind** it to a template layout, freeze
an immutable **snapshot (data + layout)**, **sign** it for third-party
verification, assign a **transcript number**, and persist the `Transcript` — the
engine the PDF/DOCX renderers (Phase 13/14) consume. **No rendering yet.**
