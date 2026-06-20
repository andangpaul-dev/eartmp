/**
 * User administration use-cases: CreateUser, DeactivateUser, AssignRole.
 *
 * Each is permission-gated through the fail-closed authorization seam and
 * audits its write. The acting user is taken from the session, never from
 * input (F-16). Password is hashed before storage; plaintext never persisted.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { AuthorizationError } from "../../../domain/errors/auth";
import { ValidationError } from "../../../domain/errors/validation";
import type { UserAccount, Role } from "../../../domain/entities/auth";
import type {
  UserRepository,
  RoleRepository,
} from "../../../domain/repositories/auth";
import type { AuditLogPort } from "../../../domain/repositories";
import type { FacultyRepository } from "../../../domain/repositories/structure";
import type { HashingPort } from "../../ports/HashingPort";
import { requireInScope } from "../../authorization/institutionScope";
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
  /** Assigned faculties (empty = institution-wide / unscoped). */
  facultyIds: string[];
}

export interface CreateUserInput {
  username: string;
  email: string;
  fullName: string;
  roleId: string;
  password: string;
  /** Optional tenant scope; omitted = global operator. */
  institutionId?: string;
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
      throw ValidationError.field(
        "username",
        "Username must be at least 3 characters.",
      );
    }
    if (input.password.length < 8) {
      throw ValidationError.field(
        "password",
        "Password must be at least 8 characters.",
      );
    }
    if (await this.users.findByUsername(username)) {
      throw ValidationError.field(
        "username",
        `Username "${username}" already exists.`,
      );
    }
    if (!(await this.roles.findById(input.roleId))) {
      throw ValidationError.field("roleId", "Selected role does not exist.");
    }
    const passwordHash = await this.hasher.hash(input.password);
    const created = await this.users.create({
      username,
      email: input.email,
      fullName: input.fullName,
      roleId: input.roleId,
      ...(input.institutionId ? { institutionId: input.institutionId } : {}),
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

export interface UpdateUserDetailsInput {
  userId: string;
  patch: { username?: string; email?: string; fullName?: string };
}
export class UpdateUserDetails implements AuthorizedUseCase<
  UpdateUserDetailsInput,
  UserAccount
> {
  readonly name = "UpdateUserDetails";
  readonly requiredPermissions = ["users.update"];
  constructor(
    private readonly users: UserRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: UpdateUserDetailsInput, session: SessionContext) {
    const before = await this.users.findById(input.userId);
    if (!before) throw new ValidationError("User not found.");
    const patch: { username?: string; email?: string; fullName?: string } = {};
    if (input.patch.username !== undefined) {
      const username = input.patch.username.trim();
      if (username.length < 3) {
        throw ValidationError.field(
          "username",
          "Username must be at least 3 characters.",
        );
      }
      const clash = await this.users.findByUsername(username);
      if (clash && clash.id !== input.userId) {
        throw ValidationError.field(
          "username",
          `Username "${username}" already exists.`,
        );
      }
      patch.username = username;
    }
    if (input.patch.email !== undefined) patch.email = input.patch.email.trim();
    if (input.patch.fullName !== undefined)
      patch.fullName = input.patch.fullName.trim();

    const updated = await this.users.update(input.userId, patch);
    await this.audit.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "User",
      recordId: input.userId,
      oldValue: { username: before.username },
      newValue: { username: updated.username },
    });
    return updated;
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
      throw ValidationError.field(
        "newPassword",
        "Password must be at least 8 characters.",
      );
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
    const [users, roles, facultiesByUser] = await Promise.all([
      this.users.list(),
      this.roles.list(),
      this.users.facultyIdsByUser(),
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
      facultyIds: facultiesByUser[u.id] ?? [],
    }));
  }
}

/**
 * SetUserFaculties — replace a user's faculty access set. Empty = institution-
 * wide. A scoped admin may only assign faculties within their own institution
 * (and only to a user in their institution). Gated users.update; audited.
 */
export interface SetUserFacultiesInput {
  userId: string;
  facultyIds: string[];
}
export class SetUserFaculties implements AuthorizedUseCase<
  SetUserFacultiesInput,
  { ok: true }
> {
  readonly name = "SetUserFaculties";
  readonly requiredPermissions = ["users.update"];

  constructor(
    private readonly users: UserRepository,
    private readonly faculties: FacultyRepository,
    private readonly audit: AuditLogPort,
  ) {}

  async execute(
    input: SetUserFacultiesInput,
    session: SessionContext,
  ): Promise<{ ok: true }> {
    const user = await this.users.findById(input.userId);
    if (!user) throw new ValidationError("User not found.");
    requireInScope(user.institutionId, session);

    // Every assigned faculty must exist and be within the admin's institution.
    for (const facultyId of input.facultyIds) {
      const faculty = await this.faculties.findById(facultyId);
      if (!faculty) throw new ValidationError("Faculty not found.");
      requireInScope(faculty.institutionId, session);
    }

    await this.users.setFaculties(input.userId, input.facultyIds);
    await this.audit.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "User",
      recordId: input.userId,
      newValue: { facultyIds: input.facultyIds },
    });
    return { ok: true };
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
    // Changing your own role can strip your admin permissions and lock you out.
    if (input.userId === session.actorId) {
      throw new AuthorizationError(
        "You cannot change your own role (ask another administrator).",
      );
    }
    if (!(await this.roles.findById(input.roleId))) {
      throw ValidationError.field("roleId", "Selected role does not exist.");
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
