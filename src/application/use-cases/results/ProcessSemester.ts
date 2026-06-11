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
  ) {}

  async execute(
    input: ProcessSemesterUseCaseInput,
    session: SessionContext,
  ): Promise<GpaSummary> {
    const { scale, id } = await this.grading.loadGradeScaleWithId(
      input.gradeScaleRef,
    );
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
