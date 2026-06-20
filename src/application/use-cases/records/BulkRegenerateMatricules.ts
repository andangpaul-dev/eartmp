/**
 * BulkRegenerateMatricules — re-issue matricules for an entire faculty cohort
 * (admission year) in a single transaction.
 *
 * Guard: students with any issued (APPROVED or LOCKED) transcripts are skipped
 * rather than aborted — the caller receives a list of their matricule numbers.
 *
 * Scope: the session must be authorised for the target faculty; a
 * faculty-scoped operator cannot widen past their assigned faculties.
 */
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";
import type { UnitOfWork } from "../../ports/UnitOfWork";
import type { GenerateMatricule } from "../../services/GenerateMatricule";
import type { SessionContext } from "../../../domain/value-objects/SessionContext";
import {
  requireInFacultyScope,
  scopeStudentWhere,
} from "../../authorization/institutionScope";
import { admissionYear } from "../../../domain/services/Matricule";
import { regenerateOne } from "./RegenerateMatricule";

export interface BulkRegenerateInput {
  institutionId?: string | null;
  facultyId: string;
  year: number;
}

export interface BulkRegenerateReport {
  regenerated: number;
  skipped: string[];
}

export class BulkRegenerateMatricules implements AuthorizedUseCase<
  BulkRegenerateInput,
  BulkRegenerateReport
> {
  readonly name = "BulkRegenerateMatricules";
  readonly requiredPermissions = ["students.manage"];

  constructor(
    private readonly uow: UnitOfWork,
    private readonly generate: GenerateMatricule,
  ) {}

  async execute(
    input: BulkRegenerateInput,
    session: SessionContext,
  ): Promise<BulkRegenerateReport> {
    requireInFacultyScope(input.facultyId, session);

    return this.uow.run(async (repos) => {
      const where = scopeStudentWhere({ facultyId: input.facultyId }, session);
      const page = await repos.students.find({ where, take: 1000 });

      let regenerated = 0;
      const skipped: string[] = [];

      for (const s of page.items) {
        let y: number | undefined;
        try {
          y = s.admissionSession
            ? admissionYear(s.admissionSession)
            : undefined;
        } catch {
          y = undefined;
        }
        if (y !== input.year) continue;

        if ((await repos.transcripts.countIssuedByStudent(s.id)) > 0) {
          skipped.push(s.matricNumber ?? s.id);
          continue;
        }

        await regenerateOne(repos, this.generate, s, session);
        regenerated++;
      }

      await repos.audit.record({
        userId: session.actorId,
        action: "UPDATE",
        entity: "Student",
        recordId: input.facultyId,
        newValue: {
          bulkRegenerate: {
            facultyId: input.facultyId,
            year: input.year,
            regenerated,
            skipped: skipped.length,
          },
        },
      });

      return { regenerated, skipped };
    });
  }
}
