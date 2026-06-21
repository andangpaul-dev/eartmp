/**
 * ImportResults — bulk-import results from already-parsed spreadsheet rows
 * (Phase 10). Validates every row (student/course resolve, scores in range, no
 * in-file duplicates, target not locked), builds a per-row report, and — only
 * when every row is valid and it is not a dry run — commits the whole batch in
 * one transaction (all-or-nothing, AD10.2/F-1). Reuses the Phase 9 scoring path
 * so import and manual entry agree (AD10.3). Optional `sitting` (NORMAL/RESIT)
 * and `status` (GRADED/DID/DISQUALIFIED/INCOMPLETE) columns let a batch carry
 * resits and non-graded outcomes; non-graded rows need no scores. Permission-
 * gated + audited. Import is authoritative — it does NOT enforce resit
 * eligibility.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import {
  assertSitting,
  assertStatus,
  type ResultSitting,
  type ResultStatus,
} from "../../../domain/value-objects/ResultSitting";
import type { RawRow } from "../../ports/SpreadsheetReaderPort";
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
  finalScore?: number;
  sitting: ResultSitting;
  status: ResultStatus;
  existingId?: string;
}

export class ImportResults implements AuthorizedUseCase<
  ImportResultsInput,
  ImportReport
> {
  readonly name = "ImportResults";
  readonly requiredPermissions = ["results.import"];

  constructor(
    private readonly grading: GradingConfigService,
    private readonly uow: UnitOfWork,
  ) {}

  async execute(
    input: ImportResultsInput,
    session: SessionContext,
  ): Promise<ImportReport> {
    const structure = await this.grading.loadAssessmentStructure();
    const components = structure.toComponents();

    // Validation and the commit run in ONE transaction so the lock-check and
    // existing-result lookup see the same snapshot the writes commit against —
    // no TOCTOU window where a concurrent import locks or creates a row between
    // "valid" and "written" (AD10.2/F-1). A dry run takes the same read path and
    // simply writes nothing.
    return this.uow.run(async (repos) => {
      const seen = new Set<string>();
      const errors: RowError[] = [];
      const valid: ValidEntry[] = [];

      for (let i = 0; i < input.rows.length; i++) {
        const row = input.rows[i]!;
        const messages: string[] = [];
        // Accept the camelCase keys AND the friendly header aliases, matching
        // the student/course imports.
        const matric = String(
          row.matricNumber ?? row.matric ?? row.matricNo ?? "",
        ).trim();
        const code = String(
          row.courseCode ?? row.code ?? row["Course code"] ?? "",
        ).trim();
        if (!matric) messages.push("Missing matricNumber.");
        if (!code) messages.push("Missing courseCode.");

        const student = matric
          ? await repos.students.findByMatric(matric)
          : null;
        if (matric && !student) messages.push(`Unknown student "${matric}".`);
        const course = code ? await repos.courses.findByCode(code) : null;
        if (code && !course) messages.push(`Unknown course "${code}".`);

        // Optional sitting / status (default NORMAL / GRADED), validated against
        // the value-object's allowed set. A blank OR whitespace-only cell keeps
        // the default; any other unrecognised value is a row error.
        const sittingRaw =
          String(row.sitting ?? row.Sitting ?? "")
            .trim()
            .toUpperCase() || "NORMAL";
        const statusRaw =
          String(row.status ?? row.Status ?? "")
            .trim()
            .toUpperCase() || "GRADED";
        let sitting: ResultSitting = "NORMAL";
        let status: ResultStatus = "GRADED";
        try {
          assertSitting(sittingRaw);
          sitting = sittingRaw;
        } catch (e) {
          messages.push((e as Error).message);
        }
        try {
          assertStatus(statusRaw);
          status = statusRaw;
        } catch (e) {
          messages.push((e as Error).message);
        }
        const graded = status === "GRADED";

        // Dedupe key is sitting-aware so a RESIT row never collides with the
        // student's NORMAL row.
        if (matric && code) {
          const key = `${matric}::${code}::${sitting}`;
          if (seen.has(key))
            messages.push("Duplicate row for this student/course.");
          else seen.add(key);
        }

        // Build + validate component scores ONLY for graded rows; a
        // DID/DISQUALIFIED/INCOMPLETE row carries no scores.
        const componentScores = graded
          ? components.map((c) => ({ key: c.key, score: Number(row[c.key]) }))
          : [];
        if (graded) {
          for (const c of components) {
            const v = row[c.key];
            if (v === undefined || v === "" || Number.isNaN(Number(v))) {
              messages.push(`Missing/invalid score for "${c.key}".`);
            }
          }
        }

        let finalScore: number | undefined;
        if (graded && messages.length === 0) {
          try {
            finalScore = structure.computeFinalScore(componentScores);
          } catch (e) {
            messages.push((e as Error).message);
          }
        }

        let existingId: string | undefined;
        if (messages.length === 0 && student && course) {
          const existing = (
            await repos.results.findByStudentAndSemester(
              student.id,
              input.semesterId,
            )
          ).find((r) => r.courseId === course.id && r.sitting === sitting);
          if (existing?.isLocked) {
            messages.push(
              "Existing result is locked; unlock before importing.",
            );
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
            ...(finalScore !== undefined ? { finalScore } : {}),
            sitting,
            status,
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

      for (const v of valid) {
        if (v.existingId) {
          await repos.results.updateScores(v.existingId, {
            componentScores: v.componentScores,
            // Graded rows carry a finalScore; non-graded rows clear it.
            finalScore: v.finalScore ?? null,
            status: v.status,
          });
        } else {
          await repos.results.create({
            studentId: v.studentId,
            courseId: v.courseId,
            semesterId: input.semesterId,
            componentScores: v.componentScores,
            ...(v.finalScore !== undefined ? { finalScore: v.finalScore } : {}),
            isLocked: false,
            sitting: v.sitting,
            status: v.status,
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

      return { ...base, imported: valid.length };
    });
  }
}
