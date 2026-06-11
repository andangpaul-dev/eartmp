/**
 * GetAcademicSummary — assemble a student's academic summary (Phase 11):
 * per-semester GPA, cumulative CGPA (aggregate), credits, and the configured
 * academic standing. Read-only; aggregates the STORED grade points (faithful to
 * how results were processed, AD11.1). Permission-gated (`results.read`).
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { RecordsError } from "../../../domain/errors/records";
import { GpaEngine } from "../../../domain/services/GpaEngine";
import {
  summarizeSemester,
  summarizeCumulative,
  type SemesterSummary,
  type CumulativeSummary,
  type CourseGradePoint,
} from "../../../domain/services/AcademicSummary";
import type { Course } from "../../../domain/entities";
import type {
  ResultRepository,
  CourseRepository,
} from "../../../domain/repositories/records";
import type { GradingConfigService } from "../../services/GradingConfigService";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

export interface AcademicSummary extends CumulativeSummary {
  semesters: SemesterSummary[];
  standing: string;
}

export interface GetAcademicSummaryInput {
  studentId: string;
}

export class GetAcademicSummary implements AuthorizedUseCase<
  GetAcademicSummaryInput,
  AcademicSummary
> {
  readonly name = "GetAcademicSummary";
  readonly requiredPermissions = ["results.read"];

  constructor(
    private readonly results: ResultRepository,
    private readonly courses: CourseRepository,
    private readonly grading: GradingConfigService,
  ) {}

  async execute(
    input: GetAcademicSummaryInput,
    _session: SessionContext,
  ): Promise<AcademicSummary> {
    const all = await this.results.findByStudent(input.studentId);
    // Only processed results (a resolved grade point) count (AD11.4).
    const processed = all.filter((r) => r.gradePoint !== undefined);

    const courseCache = new Map<string, Course>();
    const bySemester = new Map<string, CourseGradePoint[]>();

    for (const r of processed) {
      let course = courseCache.get(r.courseId);
      if (!course) {
        const c = await this.courses.findById(r.courseId);
        if (!c) {
          throw new RecordsError(
            `Course ${r.courseId} not found for result ${r.id}.`,
          );
        }
        course = c;
        courseCache.set(r.courseId, c);
      }
      const item: CourseGradePoint = {
        creditValue: course.creditValue,
        gradePoint: r.gradePoint!,
        creditsEarned: r.creditsEarned ?? 0,
      };
      const arr = bySemester.get(r.semesterId) ?? [];
      arr.push(item);
      bySemester.set(r.semesterId, arr);
    }

    const semesters = [...bySemester.entries()]
      .map(([semesterId, items]) => summarizeSemester(semesterId, items))
      .sort((a, b) => a.semesterId.localeCompare(b.semesterId));

    const cumulative = summarizeCumulative(semesters);
    const bands = await this.grading.loadStandingBands();
    const standing = GpaEngine.resolveStanding(cumulative.cgpa, bands);

    return { semesters, ...cumulative, standing };
  }
}
