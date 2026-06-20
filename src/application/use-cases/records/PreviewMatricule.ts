/**
 * PreviewMatricule — return the NEXT matricule that would be generated for a
 * given faculty + admission session WITHOUT consuming (incrementing) the
 * counter (Phase 5, Workstream C).
 *
 * Uses "peek" mode on GenerateMatricule so the sequence number is read but
 * never reserved. Calling it multiple times returns the same value until an
 * actual AdmitStudent/ReadmitStudent call reserves one.
 *
 * Permission: students.read (read-only, non-mutating).
 * Faculty-scope: a scoped officer may only preview matricules for their own
 * assigned faculties.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import type { UnitOfWork } from "../../ports/UnitOfWork";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";
import type { GenerateMatricule } from "../../services/GenerateMatricule";
import { requireInFacultyScope } from "../../authorization/institutionScope";

export interface PreviewMatriculeInput {
  facultyId: string;
  admissionSession: string;
}

export interface PreviewMatriculeResult {
  matricule: string;
}

export class PreviewMatricule implements AuthorizedUseCase<
  PreviewMatriculeInput,
  PreviewMatriculeResult
> {
  readonly name = "PreviewMatricule";
  readonly requiredPermissions = ["students.read"];

  constructor(
    private readonly uow: UnitOfWork,
    private readonly generate: GenerateMatricule,
  ) {}

  async execute(
    input: PreviewMatriculeInput,
    session: SessionContext,
  ): Promise<PreviewMatriculeResult> {
    requireInFacultyScope(input.facultyId, session);

    const matricule = await this.uow.run((repos) =>
      this.generate.generate(
        {
          institutionId: null,
          facultyId: input.facultyId,
          departmentId: undefined,
          admissionSession: input.admissionSession,
        },
        repos,
        "peek",
      ),
    );

    return { matricule };
  }
}
