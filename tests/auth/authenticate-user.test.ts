import { describe, it, expect } from "vitest";
import { AuthenticateUser } from "../../src/application/use-cases/auth/AuthenticateUser";
import { AuthenticationError } from "../../src/domain/errors/auth";
import type { UserAccount } from "../../src/domain/entities/auth";
import {
  FakeHasher,
  FixedClock,
  CapturingAudit,
  InMemoryUserRepository,
  InMemoryRoleRepository,
  adminRole,
} from "./fakes";

function makeUser(over: Partial<UserAccount> = {}): UserAccount {
  return {
    id: "u1",
    username: "admin",
    email: "a@e.edu",
    fullName: "Admin",
    passwordHash: "hashed:secret",
    roleId: adminRole.id,
    isActive: true,
    ...over,
  };
}

function build(users: UserAccount[]) {
  const userRepo = new InMemoryUserRepository(users);
  const roleRepo = new InMemoryRoleRepository([adminRole]);
  const audit = new CapturingAudit();
  const uc = new AuthenticateUser(
    userRepo,
    roleRepo,
    new FakeHasher(),
    audit,
    new FixedClock(),
  );
  return { uc, userRepo, audit };
}

describe("AuthenticateUser", () => {
  it("returns a session with the role's permissions on success", async () => {
    const { uc, userRepo, audit } = build([makeUser()]);
    const session = await uc.execute({ username: "admin", password: "secret" });

    expect(session.actorId).toBe("u1");
    expect(session.roleName).toBe("SUPER_ADMIN");
    expect(session.has("users.create")).toBe(true);

    // lastLoginAt stamped, LOGIN audited
    expect((await userRepo.findById("u1"))!.lastLoginAt).toEqual(
      new Date("2026-01-01T00:00:00.000Z"),
    );
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({ action: "LOGIN", entity: "User" });
  });

  it("fails generically for a wrong password (no session, no audit)", async () => {
    const { uc, audit } = build([makeUser()]);
    await expect(
      uc.execute({ username: "admin", password: "wrong" }),
    ).rejects.toBeInstanceOf(AuthenticationError);
    expect(audit.entries).toHaveLength(0);
  });

  it("fails for an unknown user without revealing which field was wrong", async () => {
    const { uc } = build([makeUser()]);
    await expect(
      uc.execute({ username: "ghost", password: "secret" }),
    ).rejects.toThrow("Invalid credentials.");
  });

  it("rejects an inactive user", async () => {
    const { uc } = build([makeUser({ isActive: false })]);
    await expect(
      uc.execute({ username: "admin", password: "secret" }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects when the user's role is missing (misconfigured account)", async () => {
    const { uc } = build([makeUser({ roleId: "nonexistent" })]);
    await expect(
      uc.execute({ username: "admin", password: "secret" }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("is declared public for the authorization seam", () => {
    const { uc } = build([makeUser()]);
    expect(uc.isPublic).toBe(true);
    expect(uc.requiredPermissions).toEqual([]);
  });
});
