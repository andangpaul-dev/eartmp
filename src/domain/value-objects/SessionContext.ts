/**
 * SessionContext — the authenticated actor and their effective permissions.
 *
 * Built once at login from the user's role; every use-case receives it and
 * checks permissions against it. Identity comes from here, never from
 * caller-supplied arguments (architecture review F-16), so a UI/webview cannot
 * assert its own privileges later.
 *
 * Immutable value object.
 */
export class SessionContext {
  private constructor(
    public readonly actorId: string,
    public readonly roleName: string,
    private readonly permissions: ReadonlySet<string>,
    public readonly isAnonymous: boolean,
  ) {}

  /** Build an authenticated session from resolved permission keys. */
  static create(
    actorId: string,
    roleName: string,
    permissionKeys: string[],
  ): SessionContext {
    if (!actorId) {
      throw new Error("SessionContext requires an actor id.");
    }
    return new SessionContext(
      actorId,
      roleName,
      new Set(permissionKeys),
      false,
    );
  }

  /** The unauthenticated session used only for public use-cases. */
  static anonymous(): SessionContext {
    return new SessionContext("", "", new Set(), true);
  }

  has(permission: string): boolean {
    return this.permissions.has(permission);
  }

  hasAll(required: string[]): boolean {
    return required.every((p) => this.permissions.has(p));
  }

  /** Snapshot of granted permission keys (for display/audit). */
  permissionList(): string[] {
    return [...this.permissions];
  }
}
