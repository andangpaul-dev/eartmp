/**
 * Grade-scale management use-cases (Phase 8). The WRITE-SIDE companion to the
 * Phase 4 read loader: every create/update validates the bands through
 * `GradeScale.create` before persisting (AD8.1), so an inconsistent scale
 * (gap/overlap/out-of-range) can never be saved. Permission-gated + audited;
 * single default per type; the active default cannot be deleted.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import {
  GradeScale,
  GradeScaleError,
  type GradeBand,
} from "../../../domain/value-objects/GradeScale";
import type {
  GradeScaleConfigRepository,
  StoredGradeScale,
} from "../../../domain/repositories/grading";
import type { AuditLogPort } from "../../../domain/repositories";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

const MANAGE = ["config.manage"];
const READ = ["config.read"];

export interface CreateGradeScaleInput {
  name: string;
  bands: GradeBand[];
}
export class CreateGradeScale implements AuthorizedUseCase<
  CreateGradeScaleInput,
  StoredGradeScale
> {
  readonly name = "CreateGradeScale";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly scales: GradeScaleConfigRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: CreateGradeScaleInput, session: SessionContext) {
    if (input.name.trim().length === 0) {
      throw new GradeScaleError("Grade scale name must not be empty.");
    }
    if (await this.scales.findByName(input.name)) {
      throw new GradeScaleError(`Grade scale "${input.name}" already exists.`);
    }
    // Validates 0-100 coverage, no gaps/overlaps, valid grade points.
    const scale = GradeScale.create(input.bands);
    const created = await this.scales.create({
      name: input.name,
      bands: JSON.stringify(scale.toBands()),
      isDefault: false,
    });
    await this.audit.record({
      userId: session.actorId,
      action: "CREATE",
      entity: "GradeScale",
      recordId: created.id,
      newValue: { name: created.name },
    });
    return created;
  }
}

export interface UpdateGradeScaleInput {
  id: string;
  name?: string;
  bands?: GradeBand[];
}
export class UpdateGradeScale implements AuthorizedUseCase<
  UpdateGradeScaleInput,
  StoredGradeScale
> {
  readonly name = "UpdateGradeScale";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly scales: GradeScaleConfigRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: UpdateGradeScaleInput, session: SessionContext) {
    const before = await this.scales.findById(input.id);
    if (!before) throw new GradeScaleError("Grade scale not found.");
    const patch: { name?: string; bands?: string } = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.bands !== undefined) {
      patch.bands = JSON.stringify(GradeScale.create(input.bands).toBands());
    }
    const updated = await this.scales.update(input.id, patch);
    await this.audit.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "GradeScale",
      recordId: input.id,
      oldValue: before,
      newValue: updated,
    });
    return updated;
  }
}

export interface DeleteGradeScaleInput {
  id: string;
}
export class DeleteGradeScale implements AuthorizedUseCase<
  DeleteGradeScaleInput,
  void
> {
  readonly name = "DeleteGradeScale";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly scales: GradeScaleConfigRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: DeleteGradeScaleInput, session: SessionContext) {
    const scale = await this.scales.findById(input.id);
    if (!scale) throw new GradeScaleError("Grade scale not found.");
    if (scale.isDefault) {
      throw new GradeScaleError(
        "Cannot delete the default grade scale; set another default first.",
      );
    }
    await this.scales.softDelete(input.id);
    await this.audit.record({
      userId: session.actorId,
      action: "DELETE",
      entity: "GradeScale",
      recordId: input.id,
    });
  }
}

export interface SetDefaultGradeScaleInput {
  id: string;
}
export class SetDefaultGradeScale implements AuthorizedUseCase<
  SetDefaultGradeScaleInput,
  void
> {
  readonly name = "SetDefaultGradeScale";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly scales: GradeScaleConfigRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: SetDefaultGradeScaleInput, session: SessionContext) {
    const scale = await this.scales.findById(input.id);
    if (!scale) throw new GradeScaleError("Grade scale not found.");
    await this.scales.setDefault(input.id);
    await this.audit.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "GradeScale",
      recordId: input.id,
      newValue: { isDefault: true },
    });
  }
}

export class ListGradeScales implements AuthorizedUseCase<
  Record<string, never>,
  StoredGradeScale[]
> {
  readonly name = "ListGradeScales";
  readonly requiredPermissions = READ;
  constructor(private readonly scales: GradeScaleConfigRepository) {}
  async execute(
    _input: Record<string, never>,
    _session: SessionContext,
  ): Promise<StoredGradeScale[]> {
    return this.scales.list();
  }
}
