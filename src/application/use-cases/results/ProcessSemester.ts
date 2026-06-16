/**
 * ProcessSemester — the authorized, configuration-aware entry point for
 * processing a student's semester (Phase 9). It loads the grade scale through
 * the validated `GradingConfigService` (read-side choke point, F-6), then runs
 * the atomic `ProcessSemesterResults` (Phase 7, F-1), stamping the grade-scale
 * id as provenance on every result (F-19). Permission-gated + (the inner
 * use-case) audited.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import type { GpaSummary } from "../../../domain/services/GpaEngine";
import type { UnitOfWork } from "../../ports/UnitOfWork";
import type { GradingConfigService } from "../../services/GradingConfigService";
import {
  ProcessSemesterResults,
  type ProcessSemesterInput,
} from "../ProcessSemesterResults";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";
import type { StudentRepository } from "../../../domain/repositories/records";
import type { LevelRepository } from "../../../domain/repositories/structure";

export interface ProcessSemesterUseCaseInput {
  studentId: string;
  semesterId: string;
  /** Optional grade-scale override; defaults to the institution default. */
  gradeScaleRef?: { id?: string; name?: string };
}

export class ProcessSemester implements AuthorizedUseCase<
  ProcessSemesterUseCaseInput,
  GpaSummary
> {
  readonly name = "ProcessSemester";
  readonly requiredPermissions = ["results.process"];

  constructor(
    private readonly uow: UnitOfWork,
    private readonly grading: GradingConfigService,
    // Optional reads to resolve a per-level grade scale (Feature 2). When the
    // student's current level carries a gradeScaleId, it is used unless the
    // operator passed an explicit override.
    private readonly students?: StudentRepository,
    private readonly levels?: LevelRepository,
  ) {}

  /**
   * Effective grade-scale ref, in precedence order:
   *   1. an explicit operator override (input.gradeScaleRef),
   *   2. the student's current level's gradeScaleId (per-level grading),
   *   3. the institution default (undefined ⇒ GradingConfigService default).
   */
  private async resolveGradeScaleRef(
    input: ProcessSemesterUseCaseInput,
  ): Promise<{ id?: string; name?: string } | undefined> {
    if (input.gradeScaleRef) return input.gradeScaleRef;
    if (!this.students || !this.levels) return undefined;
    const student = await this.students.findById(input.studentId);
    if (!student?.levelId) return undefined;
    const level = await this.levels.findById(student.levelId);
    return level?.gradeScaleId ? { id: level.gradeScaleId } : undefined;
  }

  async execute(
    input: ProcessSemesterUseCaseInput,
    session: SessionContext,
  ): Promise<GpaSummary> {
    const ref = await this.resolveGradeScaleRef(input);
    const { scale, id } = await this.grading.loadGradeScaleWithId(ref);
    const process = new ProcessSemesterResults(this.uow);
    const inner: ProcessSemesterInput = {
      studentId: input.studentId,
      semesterId: input.semesterId,
      scale,
      gradeScaleId: id,
      userId: session.actorId,
    };
    return process.execute(inner);
  }
}
