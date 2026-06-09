import { describe, it, expect } from "vitest";
import {
  authorize,
  type AuthorizedUseCase,
} from "../../src/application/authorization/AuthorizedUseCase";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { AuthorizationError } from "../../src/domain/errors/auth";

function useCase(
  policy: Partial<AuthorizedUseCase<string, string>>,
): AuthorizedUseCase<string, string> {
  return {
    name: "Test",
    requiredPermissions: [],
    ...policy,
    execute: async (input) => `ran:${input}`,
  };
}

const admin = SessionContext.create("u1", "ADMIN", ["users.create"]);

describe("authorize (fail-closed seam)", () => {
  it("runs a public use-case with no session", async () => {
    const uc = useCase({ isPublic: true });
    await expect(authorize(uc, "x", null)).resolves.toBe("ran:x");
  });

  it("DENIES by default when no policy is declared", async () => {
    const uc = useCase({}); // not public, not authenticatedOnly, no permissions
    await expect(authorize(uc, "x", admin)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("requires a session for non-public use-cases", async () => {
    const uc = useCase({ requiredPermissions: ["users.create"] });
    await expect(authorize(uc, "x", null)).rejects.toThrow(
      /Authentication required/,
    );
    await expect(
      authorize(uc, "x", SessionContext.anonymous()),
    ).rejects.toThrow(/Authentication required/);
  });

  it("allows authenticatedOnly use-cases for any session", async () => {
    const uc = useCase({ authenticatedOnly: true });
    await expect(authorize(uc, "x", admin)).resolves.toBe("ran:x");
  });

  it("enforces required permissions", async () => {
    const uc = useCase({ requiredPermissions: ["users.create"] });
    await expect(authorize(uc, "x", admin)).resolves.toBe("ran:x");

    const viewer = SessionContext.create("u2", "VIEWER", ["students.read"]);
    await expect(authorize(uc, "x", viewer)).rejects.toThrow(
      /Missing required permission/,
    );
  });

  it("requires ALL declared permissions", async () => {
    const uc = useCase({
      requiredPermissions: ["users.create", "roles.assign"],
    });
    await expect(authorize(uc, "x", admin)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});
