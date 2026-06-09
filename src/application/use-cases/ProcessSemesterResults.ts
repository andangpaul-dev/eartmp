/**
 * ProcessSemesterResults — an application use-case.
 *
 * Orchestrates the domain engines (GradeScale + GpaEngine) against repository
 * ports to compute and persist a student's processed results for a semester,
 * then returns the GPA summary. Knows nothing about Prisma or the UI.
 */

import { GradeScale } from "../../domain/value-objects/GradeScale";
import { GpaEngine, type GpaSummary } from "../../domain/services/GpaEngine";
import type {
  ResultRepository,
  CourseRepository,
  AuditLogPort,
} from "../../domain/repositories";

export interface ProcessSemesterInput {
  studentId: string;
  semesterId: string;
  scale: GradeScale;
  userId?: string;
}

export class ProcessSemesterResults {
  constructor(
    private readonly results: ResultRepository,
    private readonly courses: CourseRepository,
    private readonly audit: AuditLogPort,
  ) {}

  async execute(input: ProcessSemesterInput): Promise<GpaSummary> {
    const { studentId, semesterId, scale } = input;
    const engine = new GpaEngine(scale);

    const rawResults = await this.results.findByStudentAndSemester(
      studentId,
      semesterId,
    );
    if (rawResults.length === 0) {
      throw new Error(
        `No results found for student ${studentId} in semester ${semesterId}.`,
      );
    }

    // Resolve credit values from the course registry.
    const courseResults = [];
    for (const r of rawResults) {
      if (r.finalScore === undefined) {
        throw new Error(`Result ${r.id} has no final score; import first.`);
      }
      const course = await this.courses.findById(r.courseId);
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

    // Persist the processed grade/points back to each result.
    for (let i = 0; i < rawResults.length; i++) {
      const raw = rawResults[i]!;
      const processed = summary.courses[i]!;
      await this.results.update(raw.id, {
        grade: processed.grade,
        gradePoint: processed.gradePoint,
        creditsEarned: processed.creditsEarned,
      });
    }

    await this.audit.record({
      userId: input.userId,
      action: "PROCESS_SEMESTER",
      entity: "Result",
      recordId: studentId,
      newValue: { semesterId, gpa: summary.gpa },
    });

    return summary;
  }
}
