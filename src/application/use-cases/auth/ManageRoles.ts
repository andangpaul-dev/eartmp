/**
 * Role administration: create / rename / delete custom roles and edit a role's
 * permission set, plus list all permissions for the editor. Writes are gated
 * `roles.assign` and audited; the permission list needs `roles.read`. A role
 * with live users assigned can't be deleted.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { ValidationError } from "../../../domain/errors/validation";
import type { Role, Permission } from "../../../domain/entities/auth";
import type {
  RoleRepository,
  PermissionRepository,
} from "../../../domain/repositories/auth";
import type { AuditLogPort } from "../../../domain/repositories";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

const MANAGE = ["roles.assign"];
const READ = ["roles.read"];

export interface CreateRoleInput {
  name: string;
  description?: string;
  permissionKeys?: string[];
}
export class CreateRole implements AuthorizedUseCase<CreateRoleInput, Role> {
  readonly name = "CreateRole";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly roles: RoleRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: CreateRoleInput, session: SessionContext) {
    const name = input.name.trim();
    if (name.length < 2) {
      throw ValidationError.field(
        "name",
        "Role name must be at least 2 characters.",
      );
    }
    if (await this.roles.findByName(name)) {
      throw ValidationError.field("name", `Role "${name}" already exists.`);
    }
    let role = await this.roles.create({
      name,
      ...(input.description ? { description: input.description } : {}),
    });
    if (input.permissionKeys && input.permissionKeys.length > 0) {
      role = await this.roles.setPermissions(role.id, input.permissionKeys);
    }
    await this.audit.record({
      userId: session.actorId,
      action: "CREATE",
      entity: "Role",
      recordId: role.id,
      newValue: { name: role.name },
    });
    return role;
  }
}

export interface UpdateRoleInput {
  id: string;
  patch: { name?: string; description?: string };
}
export class UpdateRole implements AuthorizedUseCase<UpdateRoleInput, Role> {
  readonly name = "UpdateRole";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly roles: RoleRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: UpdateRoleInput, session: SessionContext) {
    const before = await this.roles.findById(input.id);
    if (!before) throw new ValidationError("Role not found.");
    if (input.patch.name !== undefined) {
      const name = input.patch.name.trim();
      if (name.length < 2) {
        throw ValidationError.field(
          "name",
          "Role name must be at least 2 characters.",
        );
      }
      const clash = await this.roles.findByName(name);
      if (clash && clash.id !== input.id) {
        throw ValidationError.field("name", `Role "${name}" already exists.`);
      }
    }
    const updated = await this.roles.update(input.id, input.patch);
    await this.audit.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "Role",
      recordId: input.id,
      oldValue: { name: before.name },
      newValue: { name: updated.name },
    });
    return updated;
  }
}

export interface DeleteRoleInput {
  id: string;
}
export class DeleteRole implements AuthorizedUseCase<DeleteRoleInput, void> {
  readonly name = "DeleteRole";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly roles: RoleRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: DeleteRoleInput, session: SessionContext) {
    const role = await this.roles.findById(input.id);
    if (!role) throw new ValidationError("Role not found.");
    if ((await this.roles.countUsers(input.id)) > 0) {
      throw new ValidationError(
        "Cannot delete a role that still has users assigned.",
      );
    }
    await this.roles.softDelete(input.id);
    await this.audit.record({
      userId: session.actorId,
      action: "DELETE",
      entity: "Role",
      recordId: input.id,
    });
  }
}

export interface SetRolePermissionsInput {
  roleId: string;
  permissionKeys: string[];
}
export class SetRolePermissions implements AuthorizedUseCase<
  SetRolePermissionsInput,
  Role
> {
  readonly name = "SetRolePermissions";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly roles: RoleRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: SetRolePermissionsInput, session: SessionContext) {
    const role = await this.roles.findById(input.roleId);
    if (!role) throw new ValidationError("Role not found.");
    const updated = await this.roles.setPermissions(
      input.roleId,
      input.permissionKeys,
    );
    await this.audit.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "Role",
      recordId: input.roleId,
      newValue: { permissions: input.permissionKeys.length },
    });
    return updated;
  }
}

export class ListPermissions implements AuthorizedUseCase<
  Record<string, never>,
  Permission[]
> {
  readonly name = "ListPermissions";
  readonly requiredPermissions = READ;
  constructor(private readonly permissions: PermissionRepository) {}
  async execute(_input: Record<string, never>, _session: SessionContext) {
    return this.permissions.findAll();
  }
}
