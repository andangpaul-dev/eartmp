# CLAUDE.md — EduCore (EARTMP) build guide for Claude Code

This file governs how Claude Code works in this repository. Read it at the start
of every session. It encodes the **Build Sequence Document (BSD)**, which is
binding.

## Project

EduCore Academic Records & Transcript Management Platform (EARTMP): an
offline-first desktop app (Tauri 2 + React 19 + TypeScript + SQLite/Prisma) for
academic records, results processing, GPA/CGPA, and template-driven transcripts.

Authoritative specs live in `/docs`:

- `docs/software-specification.md`
- `docs/software-design-package.md`
- `docs/build-sequence-document.md` ← the binding roadmap

## Non-negotiable execution rules (from BSD §11)

1. Follow the 20 phases **in order**. Phase 0 first.
2. **Never skip a phase** and **never write future-phase code.** If a task needs
   something from a later phase, stop and say so rather than building ahead.
3. Produce each phase's **deliverables before implementation**.
4. After finishing a phase, **stop and request approval.** Do not begin the next
   phase until the human approves in the chat.
5. Every phase ships with **tests** (Vitest / React Testing Library).
6. Update `/docs` continuously as decisions are made.

## Architecture rules (from BSD §2)

- Clean Architecture + DDD. Layer dependencies point inward only.
- **Domain logic never imports UI or Prisma.** Verify by keeping domain unit
  tests runnable with no DB and no React.
- **UI components never touch the database directly.** All data access goes
  through application services that depend on repository _interfaces_.
- All business rules live in domain services or application services.
- Grading systems, transcript layouts, and institution data are **always
  runtime-configured, never hardcoded** (store variable parts as JSON or rows).

## Folder structure

```
src/
  domain/          # entities, value-objects, services, repository interfaces
  application/     # use-cases / services orchestrating the domain
  infrastructure/  # Prisma repos, SheetJS import, PDFMake/DOCX, backup, QR
  presentation/    # React + Tauri UI
prisma/            # schema + migrations
tests/             # unit + integration
docs/              # the three specs + Phase 0 design docs
```

## Per-phase definition of done

- [ ] Deliverables listed in the BSD for this phase exist.
- [ ] Tests written and passing (`npm test`).
- [ ] `tsc --noEmit` clean under strict mode.
- [ ] Architecture boundaries intact (no UI→DB, no domain→framework imports).
- [ ] `/docs` updated.
- [ ] Summary posted and **approval explicitly requested.**

## Reference implementation already drafted

A domain core was prototyped ahead of the sequence (configurable `GradeScale`,
`AssessmentStructure`, `GpaEngine`, entities, repository ports, a Prisma schema
with all 23 tables, and a `ProcessSemesterResults` use-case with passing tests).
Treat it as **reference material for Phases 4/7/9**, not as approved code. When
those phases arrive, review it against the approved Phase 0 design, adapt, and
re-test — do not paste it in wholesale or use it to jump ahead.

## Current status

Phase: **0 — Solution Design (not yet started in-repo).**
No application code is approved yet (BSD §3: "No application code permitted
before approval").
