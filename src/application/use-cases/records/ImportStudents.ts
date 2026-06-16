/**
 * ImportStudents — bulk-import student records from already-parsed spreadsheet
 * rows (XLS/CSV), scoped to a chosen placement (faculty / department /
 * sub-department, and optionally programme / level / admission session). Every
 * row is validated (matric + name present, matric unique among existing live
 * students AND within the file), a per-row report is built, and — only when
 * every row is valid and it is not a dry run — the whole batch commits in one
 * transaction (all-or-nothing, mirrors ImportResults / AD10.2). Gated + audited.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import type { RawRow } from "../../ports/SpreadsheetReaderPort";
import type { UnitOfWork } from "../../ports/UnitOfWork";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

export interface StudentImportRowError {
  row: number; // 1-based data-row number
  messages: string[];
}

export interface StudentImportReport {
  totalRows: number;
  validRows: number;
  imported: number;
  errors: StudentImportRowError[];
}

export interface ImportStudentsInput {
  rows: RawRow[];
  /** Placement applied to every imported student. */
  facultyId?: string;
  departmentId?: string;
  subDepartmentId?: string;
  programmeId?: string;
  levelId?: string;
  admissionSession?: string;
  dryRun?: boolean;
}

interface ValidStudent {
  matricNumber: string;
  fullName: string;
  regNumber?: string;
  gender?: string;
  nationality?: string;
}

function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v).trim();
}

export class ImportStudents implements AuthorizedUseCase<
  ImportStudentsInput,
  StudentImportReport
> {
  readonly name = "ImportStudents";
  readonly requiredPermissions = ["students.create"];

  constructor(private readonly uow: UnitOfWork) {}

  async execute(
    input: ImportStudentsInput,
    session: SessionContext,
  ): Promise<StudentImportReport> {
    // Validation + commit in ONE transaction so the matric-uniqueness check sees
    // the same snapshot the writes commit against (no TOCTOU).
    return this.uow.run(async (repos) => {
      const seen = new Set<string>();
      const errors: StudentImportRowError[] = [];
      const valid: ValidStudent[] = [];

      for (let i = 0; i < input.rows.length; i++) {
        const row = input.rows[i]!;
        const messages: string[] = [];
        const matricNumber = str(
          row.matricNumber ?? row.matric ?? row.matricNo,
        );
        const fullName = str(row.fullName ?? row.name ?? row.fullname);

        if (!matricNumber) messages.push("Missing matricNumber.");
        if (!fullName) messages.push("Missing fullName.");

        if (matricNumber) {
          const key = matricNumber.toLowerCase();
          if (seen.has(key)) {
            messages.push("Duplicate matric number within the file.");
          } else {
            seen.add(key);
            if (await repos.students.findByMatric(matricNumber)) {
              messages.push(`Matric number "${matricNumber}" already exists.`);
            }
          }
        }

        if (messages.length > 0) {
          errors.push({ row: i + 1, messages });
        } else {
          const regNumber = str(row.regNumber ?? row.regNo);
          const gender = str(row.gender ?? row.sex);
          const nationality = str(row.nationality);
          valid.push({
            matricNumber,
            fullName,
            ...(regNumber ? { regNumber } : {}),
            ...(gender ? { gender } : {}),
            ...(nationality ? { nationality } : {}),
          });
        }
      }

      const base: StudentImportReport = {
        totalRows: input.rows.length,
        validRows: valid.length,
        imported: 0,
        errors,
      };

      if (input.dryRun || errors.length > 0) return base;

      for (const v of valid) {
        await repos.students.create({
          matricNumber: v.matricNumber,
          fullName: v.fullName,
          ...(v.regNumber ? { regNumber: v.regNumber } : {}),
          ...(v.gender ? { gender: v.gender } : {}),
          ...(v.nationality ? { nationality: v.nationality } : {}),
          ...(input.facultyId ? { facultyId: input.facultyId } : {}),
          ...(input.departmentId ? { departmentId: input.departmentId } : {}),
          ...(input.subDepartmentId
            ? { subDepartmentId: input.subDepartmentId }
            : {}),
          ...(input.programmeId ? { programmeId: input.programmeId } : {}),
          ...(input.levelId ? { levelId: input.levelId } : {}),
          ...(input.admissionSession
            ? { admissionSession: input.admissionSession }
            : {}),
          status: "ACTIVE",
        });
      }
      await repos.audit.record({
        userId: session.actorId,
        action: "IMPORT",
        entity: "Student",
        recordId: input.departmentId ?? input.facultyId ?? "bulk",
        newValue: {
          imported: valid.length,
          facultyId: input.facultyId ?? null,
          departmentId: input.departmentId ?? null,
          subDepartmentId: input.subDepartmentId ?? null,
        },
      });

      return { ...base, imported: valid.length };
    });
  }
}
