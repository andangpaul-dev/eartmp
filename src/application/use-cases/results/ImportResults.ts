/**
 * ImportResults — bulk-import results from already-parsed spreadsheet rows
 * (Phase 10). Validates every row (student/course resolve, scores in range, no
 * in-file duplicates, target not locked), builds a per-row report, and — only
 * when every row is valid and it is not a dry run — commits the whole batch in
 * one transaction (all-or-nothing, AD10.2/F-1). Reuses the Phase 9 scoring path
 * so import and manual entry agree (AD10.3). Permission-gated + audited.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import type { RawRow } from "../../ports/SpreadsheetReaderPort";
import type {
  StudentRepository,
  CourseRepository,
  ResultRepository,
} from "../../../domain/repositories/records";
import type { GradingConfigService } from "../../services/GradingConfigService";
import type { UnitOfWork } from "../../ports/UnitOfWork";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

export interface RowError {
  row: number; // 1-based data-row number
  messages: string[];
}

export interface ImportReport {
  totalRows: number;
  validRows: number;
  imported: number;
  errors: RowError[];
}

export interface ImportResultsInput {
  semesterId: string;
  rows: RawRow[];
  dryRun?: boolean;
}

interface ValidEntry {
  studentId: string;
  courseId: string;
  componentScores: { key: string; score: number }[];
  finalScore: number;
  existingId?: string;
}

export class ImportResults implements AuthorizedUseCase<
  ImportResultsInput,
  ImportReport
> {
  readonly name = "ImportResults";
  readonly requiredPermissions = ["results.import"];

  constructor(
    private readonly students: StudentRepository,
    private readonly courses: CourseRepository,
    private readonly results: ResultRepository,
    private readonly grading: GradingConfigService,
    private readonly uow: UnitOfWork,
  ) {}

  async execute(
    input: ImportResultsInput,
    session: SessionContext,
  ): Promise<ImportReport> {
    const structure = await this.grading.loadAssessmentStructure();
    const components = structure.toComponents();
    const seen = new Set<string>();
    const errors: RowError[] = [];
    const valid: ValidEntry[] = [];

    for (let i = 0; i < input.rows.length; i++) {
      const row = input.rows[i]!;
      const messages: string[] = [];
      const matric = String(row.matricNumber ?? "").trim();
      const code = String(row.courseCode ?? "").trim();
      if (!matric) messages.push("Missing matricNumber.");
      if (!code) messages.push("Missing courseCode.");

      const student = matric ? await this.students.findByMatric(matric) : null;
      if (matric && !student) messages.push(`Unknown student "${matric}".`);
      const course = code ? await this.courses.findByCode(code) : null;
      if (code && !course) messages.push(`Unknown course "${code}".`);

      if (matric && code) {
        const key = `${matric}::${code}`;
        if (seen.has(key))
          messages.push("Duplicate row for this student/course.");
        else seen.add(key);
      }

      // Build + validate component scores.
      const componentScores = components.map((c) => ({
        key: c.key,
        score: Number(row[c.key]),
      }));
      for (const c of components) {
        const v = row[c.key];
        if (v === undefined || v === "" || Number.isNaN(Number(v))) {
          messages.push(`Missing/invalid score for "${c.key}".`);
        }
      }

      let finalScore: number | undefined;
      if (messages.length === 0) {
        try {
          finalScore = structure.computeFinalScore(componentScores);
        } catch (e) {
          messages.push((e as Error).message);
        }
      }

      let existingId: string | undefined;
      if (messages.length === 0 && student && course) {
        const existing = (
          await this.results.findByStudentAndSemester(
            student.id,
            input.semesterId,
          )
        ).find((r) => r.courseId === course.id);
        if (existing?.isLocked) {
          messages.push("Existing result is locked; unlock before importing.");
        } else {
          existingId = existing?.id;
        }
      }

      if (messages.length > 0) {
        errors.push({ row: i + 1, messages });
      } else {
        valid.push({
          studentId: student!.id,
          courseId: course!.id,
          componentScores,
          finalScore: finalScore!,
          ...(existingId ? { existingId } : {}),
        });
      }
    }

    const base: ImportReport = {
      totalRows: input.rows.length,
      validRows: valid.length,
      imported: 0,
      errors,
    };

    if (input.dryRun || errors.length > 0) return base;

    await this.uow.run(async (repos) => {
      for (const v of valid) {
        if (v.existingId) {
          await repos.results.updateScores(v.existingId, {
            componentScores: v.componentScores,
            finalScore: v.finalScore,
          });
        } else {
          await repos.results.create({
            studentId: v.studentId,
            courseId: v.courseId,
            semesterId: input.semesterId,
            componentScores: v.componentScores,
            finalScore: v.finalScore,
            isLocked: false,
          });
        }
      }
      await repos.audit.record({
        userId: session.actorId,
        action: "IMPORT",
        entity: "Result",
        recordId: input.semesterId,
        newValue: { imported: valid.length },
      });
    });

    return { ...base, imported: valid.length };
  }
}
