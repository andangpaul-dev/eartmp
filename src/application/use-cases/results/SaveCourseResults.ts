/**
 * SaveCourseResults — atomic batch entry of per-course results (Task 4.4).
 *
 * Saves every row for a given (course, semester, sitting) tuple inside a single
 * UnitOfWork transaction so the batch is all-or-nothing. Enforces:
 *   - Sitting and status value-object invariants.
 *   - Per-student institution + faculty scope guard.
 *   - RESIT eligibility: a student must have attempted the course and NOT yet
 *     earned credits (i.e. failed or DID) — unless the caller holds
 *     `results.override`.
 *   - Locked-result guard — also bypassable via `results.override`.
 *
 * Permission-gated (results.process) and audited.
 */
import type { SessionContext } from "../../../domain/value-objects/SessionContext";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";
import type { UnitOfWork } from "../../ports/UnitOfWork";
import type { GradingConfigService } from "../../services/GradingConfigService";
import { RecordsError } from "../../../domain/errors/records";
import {
  type ResultSitting,
  type ResultStatus,
  assertSitting,
  assertStatus,
} from "../../../domain/value-objects/ResultSitting";
import { canOverrideResults } from "../../authorization/resultsOverride";
import {
  requireInScope,
  requireInFacultyScope,
} from "../../authorization/institutionScope";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SaveCourseResultsRow {
  studentId: string;
  componentScores: { key: string; score: number }[];
  status?: ResultStatus;
}

export interface SaveCourseResultsInput {
  semesterId: string;
  courseId: string;
  sitting: ResultSitting;
  rows: SaveCourseResultsRow[];
}

export interface SaveCourseResultsReport {
  saved: number;
  skipped: number;
  errors: { studentId: string; message: string }[];
}

// ---------------------------------------------------------------------------
// Use-case
// ---------------------------------------------------------------------------

export class SaveCourseResults implements AuthorizedUseCase<
  SaveCourseResultsInput,
  SaveCourseResultsReport
> {
  readonly name = "SaveCourseResults";
  readonly requiredPermissions = ["results.process"];

  constructor(
    private readonly grading: GradingConfigService,
    private readonly uow: UnitOfWork,
  ) {}

  async execute(
    input: SaveCourseResultsInput,
    session: SessionContext,
  ): Promise<SaveCourseResultsReport> {
    // Validate sitting up-front (throws if invalid)
    assertSitting(input.sitting);

    const override = canOverrideResults(session);
    const structure = await this.grading.loadAssessmentStructure();

    let saved = 0;

    await this.uow.run(async (repos) => {
      for (const row of input.rows) {
        // Per-student scope: load student and enforce institution + faculty scope.
        const student = await repos.students.findById(row.studentId);
        if (!student) {
          throw new RecordsError(`Student ${row.studentId} not found.`);
        }
        requireInScope(student.institutionId, session);
        requireInFacultyScope(student.facultyId, session);

        // Validate status
        const status: ResultStatus = row.status ?? "GRADED";
        assertStatus(status);

        // RESIT eligibility check (skip when override is active).
        if (input.sitting === "RESIT" && !override) {
          // Get all prior results for this student across ALL semesters for the
          // given course. A prior NORMAL result with creditsEarned > 0 means
          // the student already passed — they are not resit-eligible.
          const allPriorResults = await repos.results.findByStudent(
            row.studentId,
          );
          const priorForCourse = allPriorResults.filter(
            (r) => r.courseId === input.courseId,
          );

          const hasAttempted = priorForCourse.length > 0;
          const alreadyPassed = priorForCourse.some(
            (r) => (r.creditsEarned ?? 0) > 0,
          );

          if (!hasAttempted || alreadyPassed) {
            throw new RecordsError(
              `Student ${row.studentId} is not resit-eligible for this course.`,
            );
          }
        }

        // Compute final score for GRADED rows only.
        const graded = status === "GRADED";
        const finalScore = graded
          ? structure.computeFinalScore(row.componentScores)
          : undefined;

        // Dedupe on (student, course, semester, sitting).
        const existingRows = await repos.results.findByStudentAndSemester(
          row.studentId,
          input.semesterId,
        );
        const existing = existingRows.find(
          (r) => r.courseId === input.courseId && r.sitting === input.sitting,
        );

        // Locked-result guard.
        if (existing?.isLocked && !override) {
          throw new RecordsError(
            `A locked result blocks student ${row.studentId}.`,
          );
        }

        if (existing) {
          await repos.results.updateScores(existing.id, {
            componentScores: row.componentScores,
            finalScore: graded ? (finalScore ?? null) : null,
            status,
          });
        } else {
          await repos.results.create({
            studentId: row.studentId,
            courseId: input.courseId,
            semesterId: input.semesterId,
            componentScores: row.componentScores,
            ...(finalScore !== undefined ? { finalScore } : {}),
            isLocked: false,
            sitting: input.sitting,
            status,
          });
        }

        saved++;
      }

      await repos.audit.record({
        userId: session.actorId,
        action: "IMPORT",
        entity: "Result",
        recordId: input.courseId,
        newValue: {
          semesterId: input.semesterId,
          sitting: input.sitting,
          saved,
          ...(override ? { override: true } : {}),
        },
      });
    });

    return { saved, skipped: 0, errors: [] };
  }
}
