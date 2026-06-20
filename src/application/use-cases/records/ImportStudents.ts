/**
 * ImportStudents — bulk-import student records from already-parsed spreadsheet
 * rows (XLS/CSV), scoped to a chosen placement (faculty / department /
 * sub-department, and optionally programme / level / admission session). Every
 * row is validated (name present, matric unique among existing live students AND
 * within the file), a per-row report is built, and — only when every row is
 * valid and it is not a dry run — the whole batch commits in one transaction
 * (all-or-nothing, mirrors ImportResults / AD10.2). Gated + audited.
 *
 * Auto-generation (Phase 4.1 / WS C):
 *  - When a row omits a matricule, one is generated via GenerateMatricule
 *    ("reserve" mode) ONLY in the write loop — never during the validation pass.
 *    This means the counter is never incremented on an invalid batch (rollback-safe).
 *  - Per-row `admissionSession` overrides the batch-level session for generation.
 *  - Per-row `faculty` (code) is resolved to a facultyId via FacultyByCode and
 *    faculty-scope-checked against the acting session; unknown or out-of-scope
 *    codes become row errors in the validation pass.
 *  - Import-provided matricules are used as-is (no format validation — imports
 *    are kept lenient; only uniqueness is enforced).
 */
import { admissionYear } from "../../../domain/services/Matricule";
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { assertInFacultyScope } from "../../authorization/institutionScope";
import type { RawRow } from "../../ports/SpreadsheetReaderPort";
import type { UnitOfWork } from "../../ports/UnitOfWork";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";
import type {
  GenerateMatricule,
  MatriculeSettingsPort,
} from "../../services/GenerateMatricule";

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

/** Minimal port for looking up a faculty by its code string. */
export interface FacultyByCode {
  findByCode(code: string): Promise<{ id: string } | null>;
}

interface ValidStudent {
  matricNumber: string | null; // null = needs generation in write loop
  fullName: string;
  regNumber?: string;
  gender?: string;
  nationality?: string;
  /** Effective facultyId for this row (row-level or batch-level). */
  facultyId?: string;
  /** Effective admissionSession for this row (row-level or batch-level). */
  admissionSession?: string;
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

  constructor(
    private readonly uow: UnitOfWork,
    private readonly generate?: GenerateMatricule,
    private readonly settings?: MatriculeSettingsPort,
    private readonly facultyByCode?: FacultyByCode,
  ) {}

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

      // -----------------------------------------------------------------------
      // VALIDATION PASS — no writes, no counter increments here.
      // -----------------------------------------------------------------------
      for (let i = 0; i < input.rows.length; i++) {
        const row = input.rows[i]!;
        const messages: string[] = [];

        const providedMatric = str(
          row.matricNumber ?? row.matric ?? row.matricNo,
        );
        const fullName = str(row.fullName ?? row.name ?? row.fullname);
        const rowAdmissionSession = str(row.admissionSession);
        const rowFacultyCode = str(row.faculty ?? row.facultyCode);

        // -- Name --
        if (!fullName) messages.push("Missing fullName.");

        // -- Faculty (per-row override) --
        let rowFacultyId: string | undefined = input.facultyId;
        if (rowFacultyCode) {
          if (!this.facultyByCode) {
            messages.push(
              `Per-row faculty code "${rowFacultyCode}" is not supported (no faculty lookup configured).`,
            );
          } else {
            const resolved =
              await this.facultyByCode.findByCode(rowFacultyCode);
            if (!resolved) {
              messages.push(`Unknown faculty code "${rowFacultyCode}".`);
            } else {
              // Faculty-scope check: assert the resolved faculty is within the
              // acting officer's allowed faculties.
              if (!assertInFacultyScope(resolved.id, session)) {
                messages.push(
                  `Faculty "${rowFacultyCode}" is outside your permitted faculties.`,
                );
              } else {
                rowFacultyId = resolved.id;
              }
            }
          }
        }

        // -- Admission session (needed for auto-generation validation) --
        const effectiveSession =
          (rowAdmissionSession || input.admissionSession) ?? "";

        // -- Matricule --
        let needsGeneration = false;
        if (providedMatric) {
          // Import-provided matric: lenient (no format validation).
          const key = providedMatric.toLowerCase();
          if (seen.has(key)) {
            messages.push("Duplicate matric number within the file.");
          } else {
            seen.add(key);
            if (await repos.students.findByMatric(providedMatric)) {
              messages.push(
                `Matric number "${providedMatric}" already exists.`,
              );
            }
          }
        } else if (this.generate) {
          // Auto-generation: validate the session is parseable now (fail-fast),
          // but do NOT call generate.generate() yet (counter-safe).
          if (!effectiveSession) {
            messages.push(
              "Missing admissionSession (required for matricule auto-generation).",
            );
          } else {
            try {
              admissionYear(effectiveSession);
            } catch {
              messages.push(
                `Invalid admissionSession "${effectiveSession}" — cannot parse year.`,
              );
            }
          }
          if (!rowFacultyId) {
            messages.push(
              "facultyId is required for auto-generation but was not provided.",
            );
          }
          needsGeneration = true;
        } else {
          // No generator configured; fall back to old behaviour.
          messages.push("Missing matricNumber.");
        }

        if (messages.length > 0) {
          errors.push({ row: i + 1, messages });
        } else {
          const regNumber = str(row.regNumber ?? row.regNo);
          const gender = str(row.gender ?? row.sex);
          const nationality = str(row.nationality);
          valid.push({
            matricNumber: needsGeneration ? null : providedMatric,
            fullName,
            ...(regNumber ? { regNumber } : {}),
            ...(gender ? { gender } : {}),
            ...(nationality ? { nationality } : {}),
            facultyId: rowFacultyId,
            admissionSession: effectiveSession || undefined,
          });
        }
      }

      const base: StudentImportReport = {
        totalRows: input.rows.length,
        validRows: valid.length,
        imported: 0,
        errors,
      };

      // Early exit: do NOT touch the counter or write anything on error.
      if (input.dryRun || errors.length > 0) return base;

      // -----------------------------------------------------------------------
      // WRITE LOOP — only reached when every row is valid.
      // Counter increments happen here (rollback-safe).
      // -----------------------------------------------------------------------
      for (const v of valid) {
        let matric: string;
        if (v.matricNumber === null) {
          // Auto-generate; facultyId and admissionSession are guaranteed by the
          // validation pass above.
          matric = await this.generate!.generate(
            {
              institutionId: null,
              facultyId: v.facultyId!,
              admissionSession: v.admissionSession!,
            },
            repos,
            "reserve",
          );
        } else {
          matric = v.matricNumber;
        }

        await repos.students.create({
          matricNumber: matric,
          fullName: v.fullName,
          ...(v.regNumber ? { regNumber: v.regNumber } : {}),
          ...(v.gender ? { gender: v.gender } : {}),
          ...(v.nationality ? { nationality: v.nationality } : {}),
          ...(v.facultyId ? { facultyId: v.facultyId } : {}),
          ...(input.departmentId ? { departmentId: input.departmentId } : {}),
          ...(input.subDepartmentId
            ? { subDepartmentId: input.subDepartmentId }
            : {}),
          ...(input.programmeId ? { programmeId: input.programmeId } : {}),
          ...(input.levelId ? { levelId: input.levelId } : {}),
          ...(v.admissionSession
            ? { admissionSession: v.admissionSession }
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
