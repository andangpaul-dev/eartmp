/**
 * Assessment-structure management use-cases (Phase 8). Write-side companion to
 * the Phase 4 read loader: every create/update validates the components through
 * `AssessmentStructure.create` (weights sum to 100, unique keys, positive
 * maxScore) before persisting (AD8.1). Permission-gated + audited; single
 * default; the active default cannot be deleted.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import {
  AssessmentStructure,
  AssessmentError,
  type AssessmentComponent,
} from "../../../domain/value-objects/AssessmentStructure";
import type {
  AssessmentConfigRepository,
  StoredAssessmentConfig,
} from "../../../domain/repositories/grading";
import type { AuditLogPort } from "../../../domain/repositories";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

const MANAGE = ["config.manage"];
const READ = ["config.read"];

export interface CreateAssessmentConfigInput {
  name: string;
  components: AssessmentComponent[];
}
export class CreateAssessmentConfig implements AuthorizedUseCase<
  CreateAssessmentConfigInput,
  StoredAssessmentConfig
> {
  readonly name = "CreateAssessmentConfig";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly configs: AssessmentConfigRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: CreateAssessmentConfigInput, session: SessionContext) {
    if (input.name.trim().length === 0) {
      throw new AssessmentError("Assessment structure name must not be empty.");
    }
    if (await this.configs.findByName(input.name)) {
      throw new AssessmentError(
        `Assessment structure "${input.name}" already exists.`,
      );
    }
    const structure = AssessmentStructure.create(input.components);
    const created = await this.configs.create({
      name: input.name,
      components: JSON.stringify(structure.toComponents()),
      isDefault: false,
    });
    await this.audit.record({
      userId: session.actorId,
      action: "CREATE",
      entity: "AssessmentConfig",
      recordId: created.id,
      newValue: { name: created.name },
    });
    return created;
  }
}

export interface UpdateAssessmentConfigInput {
  id: string;
  name?: string;
  components?: AssessmentComponent[];
}
export class UpdateAssessmentConfig implements AuthorizedUseCase<
  UpdateAssessmentConfigInput,
  StoredAssessmentConfig
> {
  readonly name = "UpdateAssessmentConfig";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly configs: AssessmentConfigRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: UpdateAssessmentConfigInput, session: SessionContext) {
    const before = await this.configs.findById(input.id);
    if (!before) throw new AssessmentError("Assessment structure not found.");
    const patch: { name?: string; components?: string } = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.components !== undefined) {
      patch.components = JSON.stringify(
        AssessmentStructure.create(input.components).toComponents(),
      );
    }
    const updated = await this.configs.update(input.id, patch);
    await this.audit.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "AssessmentConfig",
      recordId: input.id,
      oldValue: before,
      newValue: updated,
    });
    return updated;
  }
}

export interface DeleteAssessmentConfigInput {
  id: string;
}
export class DeleteAssessmentConfig implements AuthorizedUseCase<
  DeleteAssessmentConfigInput,
  void
> {
  readonly name = "DeleteAssessmentConfig";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly configs: AssessmentConfigRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: DeleteAssessmentConfigInput, session: SessionContext) {
    const config = await this.configs.findById(input.id);
    if (!config) throw new AssessmentError("Assessment structure not found.");
    if (config.isDefault) {
      throw new AssessmentError(
        "Cannot delete the default assessment structure; set another default first.",
      );
    }
    await this.configs.softDelete(input.id);
    await this.audit.record({
      userId: session.actorId,
      action: "DELETE",
      entity: "AssessmentConfig",
      recordId: input.id,
    });
  }
}

export interface SetDefaultAssessmentConfigInput {
  id: string;
}
export class SetDefaultAssessmentConfig implements AuthorizedUseCase<
  SetDefaultAssessmentConfigInput,
  void
> {
  readonly name = "SetDefaultAssessmentConfig";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly configs: AssessmentConfigRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(
    input: SetDefaultAssessmentConfigInput,
    session: SessionContext,
  ) {
    const config = await this.configs.findById(input.id);
    if (!config) throw new AssessmentError("Assessment structure not found.");
    await this.configs.setDefault(input.id);
    await this.audit.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "AssessmentConfig",
      recordId: input.id,
      newValue: { isDefault: true },
    });
  }
}

export class ListAssessmentConfigs implements AuthorizedUseCase<
  Record<string, never>,
  StoredAssessmentConfig[]
> {
  readonly name = "ListAssessmentConfigs";
  readonly requiredPermissions = READ;
  constructor(private readonly configs: AssessmentConfigRepository) {}
  async execute(
    _input: Record<string, never>,
    _session: SessionContext,
  ): Promise<StoredAssessmentConfig[]> {
    return this.configs.list();
  }
}
