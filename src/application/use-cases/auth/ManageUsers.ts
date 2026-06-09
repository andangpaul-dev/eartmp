/**
 * User administration use-cases: CreateUser, DeactivateUser, AssignRole.
 *
 * Each is permission-gated through the fail-closed authorization seam and
 * audits its write. The acting user is taken from the session, never from
 * input (F-16). Password is hashed before storage; plaintext never persisted.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import type { UserAccount } from "../../../domain/entities/auth";
import type { UserRepository } from "../../../domain/repositories/auth";
import type { AuditLogPort } from "../../../domain/repositories";
import type { HashingPort } from "../../ports/HashingPort";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

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
    private readonly hasher: HashingPort,
    private readonly audit: AuditLogPort,
  ) {}

  async execute(
    input: CreateUserInput,
    session: SessionContext,
  ): Promise<UserAccount> {
    const passwordHash = await this.hasher.hash(input.password);
    const created = await this.users.create({
      username: input.username,
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

export interface AssignRoleInput {
  userId: string;
  roleId: string;
}

export class AssignRole implements AuthorizedUseCase<AssignRoleInput, void> {
  readonly name = "AssignRole";
  readonly requiredPermissions = ["roles.assign"];

  constructor(
    private readonly users: UserRepository,
    private readonly audit: AuditLogPort,
  ) {}

  async execute(
    input: AssignRoleInput,
    session: SessionContext,
  ): Promise<void> {
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
