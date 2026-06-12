# EARTMP Documentation Index

**EduCore Academic Records & Transcript Management Platform** — an offline-first
desktop app (Tauri 2 + React 19 + TypeScript + SQLite/Prisma) for academic
records, results processing, GPA/CGPA, and template-driven transcripts.

**Build status: BSD 20/20 phases complete (headless core).** All domain +
application logic is implemented, tested (271 tests, ≥80% coverage), and proven
end to end (`npm run demo:e2e`). The runnable desktop product (UI + Tauri-SQL
runtime) is the remaining **shell phase**.

---

## Start here

- [runbook.md](runbook.md) — provision, run, verify, operate.
- [release-checklist.md](release-checklist.md) — the release gate.
- [build-sequence-document.md](build-sequence-document.md) — the binding 20-phase roadmap.
- [software-specification.md](software-specification.md) · [software-design-package.md](software-design-package.md)

## Phase deliverables

| Phase | Title                                                             | Docs                   |
| ----- | ----------------------------------------------------------------- | ---------------------- |
| 0     | Solution design (SAD, ERD, security, reporting, transcript, env…) | [phase-0/](phase-0/)   |
| 1     | Foundation + schema                                               | [phase-1/](phase-1/)   |
| 2     | Auth + RBAC                                                       | [phase-2/](phase-2/)   |
| 3     | Institution + settings                                            | [phase-3/](phase-3/)   |
| 4     | Grading engines (configurable)                                    | [phase-4/](phase-4/)   |
| 5     | Schema bundle + persistence patterns                              | [phase-5/](phase-5/)   |
| 6     | Students / courses / structure                                    | [phase-6/](phase-6/)   |
| 7     | Persistence foundation (UoW, optimistic locking)                  | [phase-7/](phase-7/)   |
| 8     | Config management (grade scales / assessments)                    | [phase-8/](phase-8/)   |
| 9     | Results & processing                                              | [phase-9/](phase-9/)   |
| 10    | Spreadsheet import                                                | [phase-10/](phase-10/) |
| 11    | GPA/CGPA & standing                                               | [phase-11/](phase-11/) |
| 12    | Transcript engine (bind, snapshot, sign)                          | [phase-12/](phase-12/) |
| 13    | Reporting: PDF                                                    | [phase-13/](phase-13/) |
| 14    | Reporting: DOCX                                                   | [phase-14/](phase-14/) |
| 15    | Transcript template designer                                      | [phase-15/](phase-15/) |
| 16    | Graduation & eligibility                                          | [phase-16/](phase-16/) |
| 17    | Backup & restore                                                  | [phase-17/](phase-17/) |
| 18    | Security hardening (sealed key, ADR-008)                          | [phase-18/](phase-18/) |
| 19    | Audit & observability (tamper-evident chain)                      | [phase-19/](phase-19/) |
| 20    | Final integration & release readiness                             | [phase-20/](phase-20/) |

## Key architecture decisions

- **ADR-007** — runtime data layer is the Tauri-SQL plugin; Prisma is dev-only.
- **ADR-006** — transcripts snapshot data **and** resolved layout (exact re-issue).
- **ADR-009** — transcript verification by **digital signature** (Ed25519), not a self-hash.
- **ADR-008** — DB-at-rest + secret sealing keyed by the operator passphrase (app-level done; SQLCipher wiring in the shell).
- **ADR-004** — CGPA by aggregate quality points / credits (never a mean of GPAs).

_Each phase folder has a `README.md` (status) and `implementation-notes.md`
(what was built + verification evidence)._
