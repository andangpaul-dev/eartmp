/**
 * ProcessSemesterResults — an application use-case.
 *
 * Orchestrates the domain engines (GradeScale + GpaEngine) to compute and
 * persist a student's processed results for a semester, then returns the GPA
 * summary. Knows nothing about Prisma or the UI.
 *
 * Phase 7: all writes run inside a single UnitOfWork transaction (architecture
 * review F-1) — a failure part-way through rolls back every result update, so a
 * semester can never be left half-processed. It also records grade provenance
 * (F-19) via the optional `gradeScaleId`.
 *
 * Workstream B update: uses selectEffective + SemesterOrdering to determine
 * which attempt is GPA-effective per course; stamps ALL non-locked, non-pending
 * rows (never throws on locked); computes GpaSummary from effective attempts only.
 */
import { GpaEngine, type GpaSummary } from "../../domain/services/GpaEngine";
import type { GradeScale } from "../../domain/value-objects/GradeScale";
import type { UnitOfWork } from "../ports/UnitOfWork";
import {
  selectEffective,
  type Attempt,
} from "../../domain/services/ResultAttempts";
import {
  countsAsFail,
  isPending,
} from "../../domain/value-objects/ResultSitting";

export interface ProcessSemesterInput {
  studentId: string;
  semesterId: string;
  scale: GradeScale;
  /** Provenance: which grade scale produced these grades (F-19). */
  gradeScaleId?: string;
  userId?: string;
}

export class ProcessSemesterResults {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(input: ProcessSemesterInput): Promise<GpaSummary> {
    const engine = new GpaEngine(input.scale);

    return this.uow.run(async (repos) => {
      // Load all results for this student across all semesters for effective-attempt selection.
      const all = await repos.results.findByStudent(input.studentId);
      if (all.every((r) => r.semesterId !== input.semesterId)) {
        throw new Error(
          `No results found for student ${input.studentId} in semester ${input.semesterId}.`,
        );
      }

      // Determine each semester's chronological ordering for attempt selection.
      const ord = await repos.semesterOrdering.order([
        ...new Set(all.map((r) => r.semesterId)),
      ]);

      // Select which attempt per course is GPA-effective (latest non-pending).
      const sel = selectEffective(
        all.map<Attempt>((r) => ({
          id: r.id,
          courseId: r.courseId,
          sessionOrder: ord.get(r.semesterId)?.sessionOrder ?? 0,
          semesterRank: ord.get(r.semesterId)?.rank ?? 0,
          sitting: r.sitting,
          status: r.status,
        })),
      );

      // Work only over rows in the target semester.
      const semRows = all.filter((r) => r.semesterId === input.semesterId);

      const effectiveCourseResults: {
        courseCode: string;
        creditValue: number;
        finalScore: number;
      }[] = [];

      for (const r of semRows) {
        // INCOMPLETE rows: skip entirely — not stamped, not counted.
        if (isPending(r.status)) continue;

        const course = await repos.courses.findById(r.courseId);
        if (!course) {
          throw new Error(`Course ${r.courseId} not found for result ${r.id}.`);
        }

        // DID / DISQUALIFIED count as a 0-score fail; GRADED uses the actual score.
        const score = countsAsFail(r.status) ? 0 : r.finalScore;
        if (score === undefined) {
          throw new Error(`Result ${r.id} has no final score; import first.`);
        }

        // Stamp the processed grade onto every non-locked row (skip locked silently).
        if (!r.isLocked) {
          const processed = engine.processSemester([
            {
              courseCode: course.code,
              creditValue: course.creditValue,
              finalScore: score,
            },
          ]).courses[0]!;
          await repos.results.updateProcessed(r.id, {
            grade: processed.grade,
            gradePoint: processed.gradePoint,
            creditsEarned: processed.creditsEarned,
            finalScore: score,
            ...(input.gradeScaleId ? { gradeScaleId: input.gradeScaleId } : {}),
          });
        }

        // Only the GPA-effective attempt for each course counts toward the summary.
        if (sel.effectiveIds.has(r.id)) {
          effectiveCourseResults.push({
            courseCode: course.code,
            creditValue: course.creditValue,
            finalScore: score,
          });
        }
      }

      // Compute GPA from effective attempts only (empty → zeroed summary).
      const summary = engine.processSemester(effectiveCourseResults);

      await repos.audit.record({
        userId: input.userId,
        action: "PROCESS_SEMESTER",
        entity: "Result",
        recordId: input.studentId,
        newValue: { semesterId: input.semesterId, gpa: summary.gpa },
      });

      return summary;
    });
  }
}
