/**
 * User administration use-cases: CreateUser, DeactivateUser, AssignRole.
 *
 * Each is permission-gated through the fail-closed authorization seam and
 * audits its write. The acting user is taken from the session, never from
 * input (F-16). Password is hashed before storage; plaintext never persisted.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { AuthorizationError } from "../../../domain/errors/auth";
import type { UserAccount, Role } from "../../../domain/entities/auth";
import type {
  UserRepository,
  RoleRepository,
} from "../../../domain/repositories/auth";
import type { AuditLogPort } from "../../../domain/repositories";
import type { HashingPort } from "../../ports/HashingPort";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

/** Sanitized user view for listing (never carries the password hash). */
export interface UserSummary {
  id: string;
  username: string;
  email: string;
  fullName: string;
  roleId: string;
  roleName: string;
  isActive: boolean;
  lastLoginAt?: string;
}

export interface CreateUserInput {
  username: string;
  email: string;
  fullName: string;
  roleId: string;
  password: string;
}

export class CreateUser implements AuthorizedUseCase<
  CreateUserInput,
  UserAccount
> {
  readonly name = "CreateUser";
  readonly requiredPermissions = ["users.create"];

  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly hasher: HashingPort,
    private readonly audit: AuditLogPort,
  ) {}

  async execute(
    input: CreateUserInput,
    session: SessionContext,
  ): Promise<UserAccount> {
    const username = input.username.trim();
    if (username.length < 3) {
      throw new Error("Username must be at least 3 characters.");
    }
    if (input.password.length < 8) {
      throw new Error("Password must be at least 8 characters.");
    }
    if (await this.users.findByUsername(username)) {
      throw new Error(`Username "${username}" already exists.`);
    }
    if (!(await this.roles.findById(input.roleId))) {
      throw new Error("Selected role does not exist.");
    }
    const passwordHash = await this.hasher.hash(input.password);
    const created = await this.users.create({
      username,
      email: input.email,
      fullName: input.fullName,
      roleId: input.roleId,
      passwordHash,
      isActive: true,
    });
    await this.audit.record({
      userId: session.actorId,
      action: "CREATE",
      entity: "User",
      recordId: created.id,
      newValue: { username: created.username, roleId: created.roleId },
    });
    return created;
  }
}

export interface DeactivateUserInput {
  userId: string;
}

export class DeactivateUser implements AuthorizedUseCase<
  DeactivateUserInput,
  void
> {
  readonly name = "DeactivateUser";
  readonly requiredPermissions = ["users.update"];

  constructor(
    private readonly users: UserRepository,
    private readonly audit: AuditLogPort,
  ) {}

  async execute(
    input: DeactivateUserInput,
    session: SessionContext,
  ): Promise<void> {
    if (input.userId === session.actorId) {
      throw new AuthorizationError("You cannot deactivate your own account.");
    }
    await this.users.update(input.userId, { isActive: false });
    await this.audit.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "User",
      recordId: input.userId,
      newValue: { isActive: false },
    });
  }
}

export interface ActivateUserInput {
  userId: string;
}

export class ActivateUser implements AuthorizedUseCase<
  ActivateUserInput,
  void
> {
  readonly name = "ActivateUser";
  readonly requiredPermissions = ["users.update"];

  constructor(
    private readonly users: UserRepository,
    private readonly audit: AuditLogPort,
  ) {}

  async execute(
    input: ActivateUserInput,
    session: SessionContext,
  ): Promise<void> {
    await this.users.update(input.userId, { isActive: true });
    await this.audit.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "User",
      recordId: input.userId,
      newValue: { isActive: true },
    });
  }
}

export interface ResetUserPasswordInput {
  userId: string;
  newPassword: string;
}

export class ResetUserPassword implements AuthorizedUseCase<
  ResetUserPasswordInput,
  void
> {
  readonly name = "ResetUserPassword";
  readonly requiredPermissions = ["users.update"];

  constructor(
    private readonly users: UserRepository,
    private readonly hasher: HashingPort,
    private readonly audit: AuditLogPort,
  ) {}

  async execute(
    input: ResetUserPasswordInput,
    session: SessionContext,
  ): Promise<void> {
    if (input.newPassword.length < 8) {
      throw new Error("Password must be at least 8 characters.");
    }
    const passwordHash = await this.hasher.hash(input.newPassword);
    await this.users.update(input.userId, { passwordHash });
    await this.audit.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "User",
      recordId: input.userId,
      newValue: { passwordReset: true },
    });
  }
}

export class ListUsers implements AuthorizedUseCase<
  Record<string, never>,
  UserSummary[]
> {
  readonly name = "ListUsers";
  readonly requiredPermissions = ["users.read"];

  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
  ) {}

  async execute(
    _input: Record<string, never>,
    _session: SessionContext,
  ): Promise<UserSummary[]> {
    const [users, roles] = await Promise.all([
      this.users.list(),
      this.roles.list(),
    ]);
    const roleName = new Map(roles.map((r) => [r.id, r.name]));
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      fullName: u.fullName,
      roleId: u.roleId,
      roleName: roleName.get(u.roleId) ?? "—",
      isActive: u.isActive,
      lastLoginAt: u.lastLoginAt?.toISOString(),
    }));
  }
}

export class ListRoles implements AuthorizedUseCase<
  Record<string, never>,
  Role[]
> {
  readonly name = "ListRoles";
  readonly requiredPermissions = ["roles.read"];

  constructor(private readonly roles: RoleRepository) {}

  async execute(
    _input: Record<string, never>,
    _session: SessionContext,
  ): Promise<Role[]> {
    return this.roles.list();
  }
}

export interface AssignRoleInput {
  userId: string;
  roleId: string;
}

export class AssignRole implements AuthorizedUseCase<AssignRoleInput, void> {
  readonly name = "AssignRole";
  readonly requiredPermissions = ["roles.assign"];

  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly audit: AuditLogPort,
  ) {}

  async execute(
    input: AssignRoleInput,
    session: SessionContext,
  ): Promise<void> {
    if (!(await this.roles.findById(input.roleId))) {
      throw new Error("Selected role does not exist.");
    }
    await this.users.update(input.userId, { roleId: input.roleId });
    await this.audit.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "User",
      recordId: input.userId,
      newValue: { roleId: input.roleId },
    });
  }
}
