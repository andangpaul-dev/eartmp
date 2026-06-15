/**
 * ChangePassword — an authenticated user changes their own password.
 *
 * `authenticatedOnly`: any valid session may run it, with no special
 * permission, but it only ever changes the *session actor's* password (identity
 * from session, F-16). The old password must verify first.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { AuthenticationError } from "../../../domain/errors/auth";
import type { UserRepository } from "../../../domain/repositories/auth";
import type { AuditLogPort } from "../../../domain/repositories";
import type { HashingPort } from "../../ports/HashingPort";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

export interface ChangePasswordInput {
  oldPassword: string;
  newPassword: string;
}

export class ChangePassword implements AuthorizedUseCase<
  ChangePasswordInput,
  void
> {
  readonly name = "ChangePassword";
  readonly authenticatedOnly = true;
  readonly requiredPermissions: string[] = [];

  constructor(
    private readonly users: UserRepository,
    private readonly hasher: HashingPort,
    private readonly audit: AuditLogPort,
  ) {}

  async execute(
    input: ChangePasswordInput,
    session: SessionContext,
  ): Promise<void> {
    if (input.newPassword.length < 8) {
      throw new Error("New password must be at least 8 characters.");
    }
    if (input.newPassword === input.oldPassword) {
      throw new Error("New password must differ from the current one.");
    }

    const user = await this.users.findById(session.actorId);
    if (!user) {
      throw new AuthenticationError();
    }

    const ok = await this.hasher.verify(input.oldPassword, user.passwordHash);
    if (!ok) {
      throw new AuthenticationError("Current password is incorrect.");
    }

    const passwordHash = await this.hasher.hash(input.newPassword);
    await this.users.update(user.id, { passwordHash });
    await this.audit.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "User",
      recordId: user.id,
      newValue: { passwordChanged: true },
    });
  }
}
