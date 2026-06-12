/**
 * Graduation use-cases (Phase 16). `EvaluateGraduation` returns a transparent
 * eligibility report over the academic summary + configured requirements.
 * `GraduateStudent` RE-evaluates at clearance time (never trusts a stale report,
 * AD16.4), then transitions an eligible ACTIVE student to GRADUATED via the
 * Phase 6 `canTransition` guard. Both gated + (clearance) audited.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { RecordsError } from "../../../domain/errors/records";
import {
  evaluateGraduation,
  type EligibilityReport,
  type GraduationRequirements,
  type GraduationSummary,
} from "../../../domain/services/GraduationEligibility";
import { canTransition } from "../../../domain/entities/student-status";
import type { StudentRepository } from "../../../domain/repositories/records";
import type { AuditLogPort } from "../../../domain/repositories";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

/** Provides a student's academic-summary aggregate (GetAcademicSummary satisfies it). */
export interface SummaryProvider {
  execute(
    input: { studentId: string },
    session: SessionContext,
  ): Promise<GraduationSummary>;
}

/** Loads the configured graduation requirements (GraduationConfigService satisfies it). */
export interface RequirementsProvider {
  loadRequirements(): Promise<GraduationRequirements>;
}

export interface GraduationInput {
  studentId: string;
}

export class EvaluateGraduation implements AuthorizedUseCase<
  GraduationInput,
  EligibilityReport
> {
  readonly name = "EvaluateGraduation";
  readonly requiredPermissions = ["graduation.read"];

  constructor(
    private readonly summary: SummaryProvider,
    private readonly config: RequirementsProvider,
  ) {}

  async execute(
    input: GraduationInput,
    session: SessionContext,
  ): Promise<EligibilityReport> {
    const summary = await this.summary.execute(
      { studentId: input.studentId },
      session,
    );
    const requirements = await this.config.loadRequirements();
    return evaluateGraduation(summary, requirements);
  }
}

export interface GraduateResult {
  status: string;
  report: EligibilityReport;
}

export class GraduateStudent implements AuthorizedUseCase<
  GraduationInput,
  GraduateResult
> {
  readonly name = "GraduateStudent";
  readonly requiredPermissions = ["graduation.clear"];

  constructor(
    private readonly summary: SummaryProvider,
    private readonly config: RequirementsProvider,
    private readonly students: StudentRepository,
    private readonly audit: AuditLogPort,
  ) {}

  async execute(
    input: GraduationInput,
    session: SessionContext,
  ): Promise<GraduateResult> {
    const student = await this.students.findById(input.studentId);
    if (!student) throw new RecordsError("Student not found.");

    const summary = await this.summary.execute(
      { studentId: input.studentId },
      session,
    );
    const report = evaluateGraduation(
      summary,
      await this.config.loadRequirements(),
    );
    if (!report.eligible) {
      const unmet = report.criteria
        .filter((c) => !c.met)
        .map((c) => c.name)
        .join(", ");
      throw new RecordsError(`Student is not eligible to graduate: ${unmet}.`);
    }
    if (!canTransition(student.status, "GRADUATED")) {
      throw new RecordsError(
        `Cannot graduate a student with status "${student.status}".`,
      );
    }

    await this.students.update(student.id, { status: "GRADUATED" });
    await this.audit.record({
      userId: session.actorId,
      action: "GRADUATE",
      entity: "Student",
      recordId: student.id,
      oldValue: { status: student.status },
      newValue: { status: "GRADUATED" },
    });
    return { status: "GRADUATED", report };
  }
}
