/**
 * ImportCourses — bulk-import / upsert course records from already-parsed
 * spreadsheet rows (XLS/CSV). Each row is validated (code/title present,
 * creditValue a positive integer, courseType in the allowed enum, no in-file
 * duplicate code). An existing course with the same code is updated (upsert);
 * an unknown code is created. The whole batch runs in one all-or-nothing
 * transaction — mirrors ImportStudents (AD10.2).
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import type { RawRow } from "../../ports/SpreadsheetReaderPort";
import type { UnitOfWork } from "../../ports/UnitOfWork";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";
import { COURSE_TYPES } from "./ManageCourses";

export interface CourseImportRowError {
  row: number; // 1-based data-row number
  messages: string[];
}

export interface CourseImportReport {
  totalRows: number;
  validRows: number;
  created: number;
  updated: number;
  errors: CourseImportRowError[];
}

export interface ImportCoursesInput {
  rows: RawRow[];
  /** Placement applied to every imported/upserted course. */
  programmeId?: string;
  levelId?: string;
  departmentId?: string;
  semesterRank?: number;
  dryRun?: boolean;
}

function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v).trim();
}

interface ValidCourse {
  code: string;
  title: string;
  creditValue: number;
  courseType: string;
  existingId: string | null; // null = create; string = update
}

export class ImportCourses implements AuthorizedUseCase<
  ImportCoursesInput,
  CourseImportReport
> {
  readonly name = "ImportCourses";
  readonly requiredPermissions = ["courses.create", "courses.update"];

  constructor(private readonly uow: UnitOfWork) {}

  async execute(
    input: ImportCoursesInput,
    session: SessionContext,
  ): Promise<CourseImportReport> {
    return this.uow.run(async (repos) => {
      const seen = new Set<string>();
      const errors: CourseImportRowError[] = [];
      const valid: ValidCourse[] = [];

      // -----------------------------------------------------------------------
      // VALIDATION PASS — no writes.
      // -----------------------------------------------------------------------
      for (let i = 0; i < input.rows.length; i++) {
        const row = input.rows[i]!;
        const messages: string[] = [];

        // Alias parsing
        const code = str(row.code ?? row["Course code"] ?? row.courseCode);
        const title = str(row.title ?? row["Course title"] ?? row.name);
        const rawCredit = row.creditValue ?? row["Credit Value"] ?? row.credits;
        const creditValue = Number(rawCredit);
        const rawType = str(
          row.courseType ?? row["Course type"] ?? row.type,
        ).toUpperCase();

        // Validate code
        if (!code) {
          messages.push("Missing course code.");
        }

        // Validate title
        if (!title) {
          messages.push("Missing course title.");
        }

        // Validate creditValue
        if (!Number.isInteger(creditValue) || creditValue <= 0) {
          messages.push("creditValue must be a positive integer.");
        }

        // Validate courseType
        if (!(COURSE_TYPES as readonly string[]).includes(rawType)) {
          messages.push(
            `Invalid courseType "${rawType}". Must be one of: ${COURSE_TYPES.join(", ")}.`,
          );
        }

        // In-file duplicate check (only when code is non-empty)
        if (code) {
          const key = code.toLowerCase();
          if (seen.has(key)) {
            messages.push(`Duplicate course code "${code}" within the file.`);
          } else {
            seen.add(key);
          }
        }

        if (messages.length > 0) {
          errors.push({ row: i + 1, messages });
          continue;
        }

        // Determine if this is a create or update (lookup live rows only).
        const existing = await repos.courses.findByCode(code);

        valid.push({
          code,
          title,
          creditValue,
          courseType: rawType,
          existingId: existing?.id ?? null,
        });
      }

      const base: CourseImportReport = {
        totalRows: input.rows.length,
        validRows: valid.length,
        created: 0,
        updated: 0,
        errors,
      };

      // Early exit: do NOT write anything on error or dry-run.
      if (input.dryRun || errors.length > 0) return base;

      // -----------------------------------------------------------------------
      // WRITE LOOP — only reached when every row is valid.
      // -----------------------------------------------------------------------
      const placement = {
        ...(input.programmeId ? { programmeId: input.programmeId } : {}),
        ...(input.levelId ? { levelId: input.levelId } : {}),
        ...(input.departmentId ? { departmentId: input.departmentId } : {}),
        ...(input.semesterRank !== undefined
          ? { semesterRank: input.semesterRank }
          : {}),
      };

      let created = 0;
      let updated = 0;

      for (const v of valid) {
        if (v.existingId) {
          await repos.courses.update(v.existingId, {
            title: v.title,
            creditValue: v.creditValue,
            courseType: v.courseType as never,
            ...placement,
          });
          updated++;
        } else {
          await repos.courses.create({
            code: v.code,
            title: v.title,
            creditValue: v.creditValue,
            courseType: v.courseType as never,
            ...placement,
          });
          created++;
        }
      }

      await repos.audit.record({
        userId: session.actorId,
        action: "IMPORT",
        entity: "Course",
        recordId: input.programmeId ?? input.departmentId ?? "bulk",
        newValue: {
          created,
          updated,
          programmeId: input.programmeId ?? null,
          levelId: input.levelId ?? null,
          departmentId: input.departmentId ?? null,
        },
      });

      return { ...base, created, updated };
    });
  }
}
