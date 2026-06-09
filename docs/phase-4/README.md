# Phase 4 — Domain Engines

**Status:** **IMPLEMENTED** (plan approved in chat, 2026-06-09). All gates green
(112 tests, coverage 98.1%, tsc/lint/format clean, grading demo working).
**Awaiting approval to start Phase 5.**

## Documents

| Doc                                                    | Purpose                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------- |
| [phase-4-plan.md](phase-4-plan.md)                     | Full Phase 4 spec in the mandated format (Objectives → Completion). |
| [engine-adoption-review.md](engine-adoption-review.md) | Review adopting the reference engines as approved Phase 4 code.     |
| [implementation-notes.md](implementation-notes.md)     | What was built, verification evidence, decisions honoured.          |

## Goal in one line

Adopt the configurable calculation engines (`GradeScale`, `AssessmentStructure`,
`GpaEngine`) as approved Phase 4 code, and add the **single validated config
loader** that feeds them from the database — so grading/assessment/standing are
runtime-configured, never hardcoded, and validated at one choke point (F-6).
