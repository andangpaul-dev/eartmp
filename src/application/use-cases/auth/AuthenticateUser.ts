/**
 * AuthenticateUser — verify credentials and produce an authenticated session.
 *
 * Public use-case (login itself cannot require a session). Failures are
 * deliberately generic (no user enumeration). On success it stamps
 * `lastLoginAt`, writes a LOGIN audit entry, and returns a SessionContext built
 * from the user's role permissions.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { AuthenticationError } from "../../../domain/errors/auth";
import { UserRules, rolePermissionKeys } from "../../../domain/entities/auth";
import type {
  UserRepository,
  RoleRepository,
} from "../../../domain/repositories/auth";
import type { AuditLogPort } from "../../../domain/repositories";
import type { HashingPort } from "../../ports/HashingPort";
import type { ClockPort } from "../../ports/ClockPort";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

export interface AuthenticateUserInput {
  username: string;
  password: string;
}

export class AuthenticateUser implements AuthorizedUseCase<
  AuthenticateUserInput,
  SessionContext
> {
  readonly name = "AuthenticateUser";
  readonly isPublic = true;
  readonly requiredPermissions: string[] = [];

  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly hasher: HashingPort,
    private readonly audit: AuditLogPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(input: AuthenticateUserInput): Promise<SessionContext> {
    const user = await this.users.findByUsername(input.username);
    if (!user || !UserRules.canAuthenticate(user)) {
      throw new AuthenticationError();
    }

    const ok = await this.hasher.verify(input.password, user.passwordHash);
    if (!ok) {
      throw new AuthenticationError();
    }

    const role = await this.roles.findById(user.roleId);
    if (!role) {
      // Misconfigured account (role missing) — treat as a failed login.
      throw new AuthenticationError();
    }

    await this.users.update(user.id, { lastLoginAt: this.clock.now() });
    await this.audit.record({
      userId: user.id,
      action: "LOGIN",
      entity: "User",
      recordId: user.id,
    });

    return SessionContext.create(user.id, role.name, rolePermissionKeys(role));
  }
}
