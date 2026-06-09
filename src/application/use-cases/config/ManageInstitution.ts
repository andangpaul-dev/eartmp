/**
 * Institution profile use-cases: GetInstitution, UpdateInstitution.
 * Permission-gated through the fail-closed seam and audited (old → new).
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import {
  InstitutionRules,
  type Institution,
} from "../../../domain/entities/institution";
import { InstitutionError } from "../../../domain/errors/config";
import type { InstitutionRepository } from "../../../domain/repositories/config";
import type { AuditLogPort } from "../../../domain/repositories";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

export class GetInstitution implements AuthorizedUseCase<
  Record<string, never>,
  Institution
> {
  readonly name = "GetInstitution";
  readonly requiredPermissions = ["settings.read"];

  constructor(private readonly institutions: InstitutionRepository) {}

  async execute(
    _input: Record<string, never>,
    _session: SessionContext,
  ): Promise<Institution> {
    const inst = await this.institutions.get();
    if (!inst) {
      throw new InstitutionError("Institution is not provisioned.");
    }
    return inst;
  }
}

export interface UpdateInstitutionInput {
  patch: Partial<Institution>;
}

export class UpdateInstitution implements AuthorizedUseCase<
  UpdateInstitutionInput,
  Institution
> {
  readonly name = "UpdateInstitution";
  readonly requiredPermissions = ["institution.manage"];

  constructor(
    private readonly institutions: InstitutionRepository,
    private readonly audit: AuditLogPort,
  ) {}

  async execute(
    input: UpdateInstitutionInput,
    session: SessionContext,
  ): Promise<Institution> {
    const { patch } = input;
    if (
      patch.calendarType !== undefined &&
      !InstitutionRules.isValidCalendarType(patch.calendarType)
    ) {
      throw new InstitutionError(
        `Invalid calendarType "${patch.calendarType}".`,
      );
    }

    const before = await this.institutions.get();
    if (!before) {
      throw new InstitutionError("Institution is not provisioned.");
    }

    const updated = await this.institutions.update(patch);
    await this.audit.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "Institution",
      recordId: updated.id,
      oldValue: before,
      newValue: updated,
    });
    return updated;
  }
}
