/**
 * Transcript template management (Phase 15) — CRUD over TranscriptTemplate, each
 * layout VALIDATED before persist (grammar + sample-bind dry run, AD15.2).
 * Updates bump the version (AD15.3); one default per institution; the default and
 * in-use templates can't be deleted (AD15.4). Gated by `templates.manage` /
 * `templates.read`, audited.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { TranscriptError } from "../../../domain/errors/transcript";
import { validateTemplateLayout } from "../../../domain/services/TranscriptTemplateValidation";
import type {
  TranscriptTemplateStore,
  StoredTemplate,
} from "../../../domain/repositories/transcripts";
import type { AuditLogPort } from "../../../domain/repositories";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

function assertValidLayout(layout: unknown): void {
  const errors = validateTemplateLayout(layout);
  if (errors.length > 0) {
    throw new TranscriptError(`Invalid template layout: ${errors.join("; ")}`);
  }
}

export interface CreateTemplateInput {
  name: string;
  layout: unknown; // block tree (object)
  isDefault?: boolean;
}
export class CreateTemplate implements AuthorizedUseCase<
  CreateTemplateInput,
  StoredTemplate
> {
  readonly name = "CreateTemplate";
  readonly requiredPermissions = ["templates.manage"];
  constructor(
    private readonly templates: TranscriptTemplateStore,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: CreateTemplateInput, session: SessionContext) {
    if (await this.templates.findByName(input.name)) {
      throw new TranscriptError(
        `A template named "${input.name}" already exists.`,
      );
    }
    assertValidLayout(input.layout);
    const created = await this.templates.create({
      name: input.name,
      layout: JSON.stringify(input.layout),
      isDefault: false,
    });
    if (input.isDefault) await this.templates.setDefault(created.id);
    await this.audit.record({
      userId: session.actorId,
      action: "CREATE",
      entity: "TranscriptTemplate",
      recordId: created.id,
      newValue: { name: created.name },
    });
    return input.isDefault ? { ...created, isDefault: true } : created;
  }
}

export interface UpdateTemplateInput {
  id: string;
  name?: string;
  layout?: unknown;
}
export class UpdateTemplate implements AuthorizedUseCase<
  UpdateTemplateInput,
  StoredTemplate
> {
  readonly name = "UpdateTemplate";
  readonly requiredPermissions = ["templates.manage"];
  constructor(
    private readonly templates: TranscriptTemplateStore,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: UpdateTemplateInput, session: SessionContext) {
    const current = await this.templates.findById(input.id);
    if (!current) throw new TranscriptError("Template not found.");
    if (input.layout !== undefined) assertValidLayout(input.layout);
    const updated = await this.templates.update(input.id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.layout !== undefined
        ? { layout: JSON.stringify(input.layout) }
        : {}),
      version: current.version + 1, // bump on every edit (AD15.3)
    });
    await this.audit.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "TranscriptTemplate",
      recordId: input.id,
      newValue: { version: updated.version },
    });
    return updated;
  }
}

export interface CloneTemplateInput {
  id: string;
  name: string;
}
export class CloneTemplate implements AuthorizedUseCase<
  CloneTemplateInput,
  StoredTemplate
> {
  readonly name = "CloneTemplate";
  readonly requiredPermissions = ["templates.manage"];
  constructor(
    private readonly templates: TranscriptTemplateStore,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: CloneTemplateInput, session: SessionContext) {
    const source = await this.templates.findById(input.id);
    if (!source) throw new TranscriptError("Template not found.");
    if (await this.templates.findByName(input.name)) {
      throw new TranscriptError(
        `A template named "${input.name}" already exists.`,
      );
    }
    const created = await this.templates.create({
      name: input.name,
      layout: source.layout,
      isDefault: false,
    });
    await this.audit.record({
      userId: session.actorId,
      action: "CREATE",
      entity: "TranscriptTemplate",
      recordId: created.id,
      newValue: { clonedFrom: source.id },
    });
    return created;
  }
}

export interface SetDefaultTemplateInput {
  id: string;
}
export class SetDefaultTemplate implements AuthorizedUseCase<
  SetDefaultTemplateInput,
  void
> {
  readonly name = "SetDefaultTemplate";
  readonly requiredPermissions = ["templates.manage"];
  constructor(
    private readonly templates: TranscriptTemplateStore,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: SetDefaultTemplateInput, session: SessionContext) {
    const t = await this.templates.findById(input.id);
    if (!t) throw new TranscriptError("Template not found.");
    await this.templates.setDefault(input.id);
    await this.audit.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "TranscriptTemplate",
      recordId: input.id,
      newValue: { isDefault: true },
    });
  }
}

export interface DeleteTemplateInput {
  id: string;
}
export class DeleteTemplate implements AuthorizedUseCase<
  DeleteTemplateInput,
  void
> {
  readonly name = "DeleteTemplate";
  readonly requiredPermissions = ["templates.manage"];
  constructor(
    private readonly templates: TranscriptTemplateStore,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: DeleteTemplateInput, session: SessionContext) {
    const t = await this.templates.findById(input.id);
    if (!t) throw new TranscriptError("Template not found.");
    if (t.isDefault) {
      throw new TranscriptError("Cannot delete the default template.");
    }
    if ((await this.templates.countTranscriptsUsing(input.id)) > 0) {
      throw new TranscriptError(
        "Cannot delete a template referenced by issued transcripts.",
      );
    }
    await this.templates.softDelete(input.id);
    await this.audit.record({
      userId: session.actorId,
      action: "DELETE",
      entity: "TranscriptTemplate",
      recordId: input.id,
    });
  }
}

export class ListTemplates implements AuthorizedUseCase<
  Record<string, never>,
  StoredTemplate[]
> {
  readonly name = "ListTemplates";
  readonly requiredPermissions = ["templates.read"];
  constructor(private readonly templates: TranscriptTemplateStore) {}
  async execute(_input: Record<string, never>, _session: SessionContext) {
    return this.templates.list();
  }
}
