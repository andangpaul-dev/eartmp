/**
 * Multi-institution management: list / create / update / delete institutions and
 * choose the default (the one transcripts resolve). Writes gated
 * `institution.manage` and audited; the list needs `settings.read`. An
 * institution with live faculties can't be deleted, and the default can't be
 * deleted (reassign the default first).
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

const MANAGE = ["institution.manage"];
const READ = ["settings.read"];

export class ListInstitutions implements AuthorizedUseCase<
  Record<string, never>,
  Institution[]
> {
  readonly name = "ListInstitutions";
  readonly requiredPermissions = READ;
  constructor(private readonly institutions: InstitutionRepository) {}
  async execute(_input: Record<string, never>, session: SessionContext) {
    const all = await this.institutions.list();
    // Tenant isolation: a scoped operator only sees their own institution.
    return session.isGlobal
      ? all
      : all.filter((i) => i.id === session.institutionId);
  }
}

export interface CreateInstitutionInput {
  name: string;
  code?: string;
  calendarType?: string;
}
export class CreateInstitution implements AuthorizedUseCase<
  CreateInstitutionInput,
  Institution
> {
  readonly name = "CreateInstitution";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly institutions: InstitutionRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: CreateInstitutionInput, session: SessionContext) {
    if (input.name.trim().length === 0) {
      throw new InstitutionError("Institution name must not be empty.");
    }
    if (
      input.calendarType !== undefined &&
      !InstitutionRules.isValidCalendarType(input.calendarType)
    ) {
      throw new InstitutionError(
        `Invalid calendar type "${input.calendarType}".`,
      );
    }
    const created = await this.institutions.create({
      name: input.name.trim(),
      ...(input.code ? { code: input.code.trim() } : {}),
      ...(input.calendarType
        ? { calendarType: input.calendarType as Institution["calendarType"] }
        : {}),
    });
    await this.audit.record({
      userId: session.actorId,
      action: "CREATE",
      entity: "Institution",
      recordId: created.id,
      newValue: { name: created.name },
    });
    return created;
  }
}

export interface UpdateInstitutionByIdInput {
  id: string;
  patch: Partial<Institution>;
}
export class UpdateInstitutionById implements AuthorizedUseCase<
  UpdateInstitutionByIdInput,
  Institution
> {
  readonly name = "UpdateInstitutionById";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly institutions: InstitutionRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: UpdateInstitutionByIdInput, session: SessionContext) {
    const before = await this.institutions.findById(input.id);
    if (!before) throw new InstitutionError("Institution not found.");
    if (
      input.patch.calendarType !== undefined &&
      !InstitutionRules.isValidCalendarType(input.patch.calendarType)
    ) {
      throw new InstitutionError(
        `Invalid calendar type "${input.patch.calendarType}".`,
      );
    }
    // isDefault is changed only via SetDefaultInstitution (keeps the invariant).
    const { isDefault: _drop, ...safe } = input.patch;
    const updated = await this.institutions.updateById(input.id, safe);
    await this.audit.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "Institution",
      recordId: input.id,
      newValue: { name: updated.name },
    });
    return updated;
  }
}

export interface DeleteInstitutionInput {
  id: string;
}
export class DeleteInstitution implements AuthorizedUseCase<
  DeleteInstitutionInput,
  void
> {
  readonly name = "DeleteInstitution";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly institutions: InstitutionRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: DeleteInstitutionInput, session: SessionContext) {
    const inst = await this.institutions.findById(input.id);
    if (!inst) throw new InstitutionError("Institution not found.");
    if (inst.isDefault) {
      throw new InstitutionError(
        "Cannot delete the default institution — set another as default first.",
      );
    }
    if ((await this.institutions.countLiveFaculties(input.id)) > 0) {
      throw new InstitutionError(
        "Cannot delete an institution that still has faculties.",
      );
    }
    await this.institutions.softDelete(input.id);
    await this.audit.record({
      userId: session.actorId,
      action: "DELETE",
      entity: "Institution",
      recordId: input.id,
    });
  }
}

export interface SetDefaultInstitutionInput {
  id: string;
}
export class SetDefaultInstitution implements AuthorizedUseCase<
  SetDefaultInstitutionInput,
  void
> {
  readonly name = "SetDefaultInstitution";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly institutions: InstitutionRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: SetDefaultInstitutionInput, session: SessionContext) {
    const inst = await this.institutions.findById(input.id);
    if (!inst) throw new InstitutionError("Institution not found.");
    await this.institutions.setDefault(input.id);
    await this.audit.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "Institution",
      recordId: input.id,
      newValue: { isDefault: true },
    });
  }
}
