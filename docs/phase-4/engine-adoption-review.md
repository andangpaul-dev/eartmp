# Phase 4 — Engine Adoption Review

Per CLAUDE.md, the reference engines are "reference material for Phase 4 — review
against the approved Phase 0 design, adapt, re-test; do not paste in wholesale."
This note records that review. Verdict: **adopt as-is** (no changes needed); the
new work is the validated config loader around them.

## Engines reviewed

| Engine                | File                                              | Verdict vs design/ADRs                                                                                                                                       |
| --------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GradeScale`          | `src/domain/value-objects/GradeScale.ts`          | ✅ Validates at construction (0–100, no gaps/overlaps/inverted ranges). Matches "configuration validated before use" and "no hardcoded grading rules." Pure. |
| `AssessmentStructure` | `src/domain/value-objects/AssessmentStructure.ts` | ✅ Weights sum to 100, unique keys, per-component max enforced. Pure.                                                                                        |
| `GpaEngine`           | `src/domain/services/GpaEngine.ts`                | ✅ Credit-weighted GPA; **CGPA by aggregate quality points/credits, not mean of GPAs** (ADR-004, tested); configurable standing bands. Pure.                 |

## Checks performed

- **Purity (AD4.1):** the engines import only other domain modules; they run
  under Vitest with no DB/UI. The architecture fitness test continues to guard
  this. ✅
- **Correctness (ADR-004):** the cumulative-by-aggregate behaviour is covered by
  `tests/engines.test.ts` ("computes cumulative GPA … by aggregate, not mean")
  and the branch suite. ✅
- **Configurability (no hardcoding):** grading bands, assessment components, and
  standing bands are all supplied at runtime — and as of Phase 4 are loaded from
  the DB through `GradingConfigService`. ✅
- **Error typing:** invalid configuration throws `GradeScaleError` /
  `AssessmentError`, surfaced cleanly by the loader. ✅

## Outcome

No engine code changed. Phase 4 adds:

- `GradingConfigService` — the single validated loader (closes **F-6**).
- `grading.standingBands` setting — standing as configuration (AD4.3).
- read ports + dev Prisma adapters + `demo:grading`.

Provenance (F-19 — recording _which_ scale graded a result) remains deferred to
Phase 9 atop the pre-Phase-5 schema bundle; the loader already resolves a scale
by id/name so it is wireable then.
