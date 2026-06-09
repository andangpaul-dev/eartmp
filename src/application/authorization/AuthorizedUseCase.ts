/**
 * The fail-closed authorization seam (architecture review ADR-011 / AD2.1).
 *
 * Every use-case declares its authorization requirement up front; the
 * `authorize` runner is the single gate that must be passed to execute one.
 * The default is DENY: a use-case that declares no access policy cannot run.
 * This makes "forgot to add a permission check" a hard failure, not a silent
 * privilege hole.
 *
 * Access policy (exactly one must be true to run):
 *   - `isPublic`         → anyone, even unauthenticated (e.g. login itself)
 *   - `authenticatedOnly`→ any authenticated session, no specific permission
 *                          (e.g. changing your own password)
 *   - `requiredPermissions` non-empty → session must hold ALL of them
 * Anything else → denied.
 */
import { SessionContext } from "../../domain/value-objects/SessionContext";
import { AuthorizationError } from "../../domain/errors/auth";

export interface AuthorizedUseCase<TInput, TOutput> {
  /** Permissions the caller's session must hold (ANDed). */
  readonly requiredPermissions: string[];
  /** Runnable with no authentication at all. */
  readonly isPublic?: boolean;
  /** Runnable by any authenticated session without a specific permission. */
  readonly authenticatedOnly?: boolean;
  /** Stable name for audit/diagnostics. */
  readonly name: string;
  execute(input: TInput, session: SessionContext): Promise<TOutput>;
}

/**
 * Run a use-case through the authorization gate. Throws AuthorizationError
 * (fail-closed) unless the session satisfies the use-case's access policy.
 */
export async function authorize<TInput, TOutput>(
  useCase: AuthorizedUseCase<TInput, TOutput>,
  input: TInput,
  session: SessionContext | null,
): Promise<TOutput> {
  if (useCase.isPublic) {
    return useCase.execute(input, session ?? SessionContext.anonymous());
  }

  // From here on, a real authenticated session is required.
  if (!session || session.isAnonymous) {
    throw new AuthorizationError("Authentication required.");
  }

  if (useCase.authenticatedOnly) {
    return useCase.execute(input, session);
  }

  if (useCase.requiredPermissions.length === 0) {
    // Misconfiguration: no policy declared → deny by default.
    throw new AuthorizationError(
      `Use-case "${useCase.name}" declares no access policy; denied.`,
    );
  }

  if (!session.hasAll(useCase.requiredPermissions)) {
    throw new AuthorizationError(
      `Missing required permission(s) for "${useCase.name}".`,
    );
  }

  return useCase.execute(input, session);
}
