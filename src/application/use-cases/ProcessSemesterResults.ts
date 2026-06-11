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
 */
import { GpaEngine, type GpaSummary } from "../../domain/services/GpaEngine";
import type { GradeScale } from "../../domain/value-objects/GradeScale";
import type { UnitOfWork } from "../ports/UnitOfWork";

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
      const rawResults = await repos.results.findByStudentAndSemester(
        input.studentId,
        input.semesterId,
      );
      if (rawResults.length === 0) {
        throw new Error(
          `No results found for student ${input.studentId} in semester ${input.semesterId}.`,
        );
      }

      // A locked semester is immutable; unlock before re-processing (AD9.3).
      const locked = rawResults.find((r) => r.isLocked);
      if (locked) {
        throw new Error(
          `Result ${locked.id} is locked; unlock before re-processing.`,
        );
      }

      // Resolve credit values from the course registry.
      const courseResults = [];
      for (const r of rawResults) {
        if (r.finalScore === undefined) {
          throw new Error(`Result ${r.id} has no final score; import first.`);
        }
        const course = await repos.courses.findById(r.courseId);
        if (!course) {
          throw new Error(`Course ${r.courseId} not found for result ${r.id}.`);
        }
        courseResults.push({
          courseCode: course.code,
          creditValue: course.creditValue,
          finalScore: r.finalScore,
        });
      }

      const summary = engine.processSemester(courseResults);

      // Persist the processed grade/points back to each result (atomically).
      for (let i = 0; i < rawResults.length; i++) {
        const raw = rawResults[i]!;
        const processed = summary.courses[i]!;
        await repos.results.updateProcessed(raw.id, {
          grade: processed.grade,
          gradePoint: processed.gradePoint,
          creditsEarned: processed.creditsEarned,
          finalScore: processed.finalScore,
          ...(input.gradeScaleId ? { gradeScaleId: input.gradeScaleId } : {}),
        });
      }

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
