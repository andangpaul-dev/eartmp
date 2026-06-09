import { describe, it, expect } from "vitest";
import { ChangePassword } from "../../src/application/use-cases/auth/ChangePassword";
import { AuthenticationError } from "../../src/domain/errors/auth";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import type { UserAccount } from "../../src/domain/entities/auth";
import {
  FakeHasher,
  CapturingAudit,
  InMemoryUserRepository,
  adminRole,
} from "./fakes";

const user: UserAccount = {
  id: "u1",
  username: "admin",
  email: "a@e.edu",
  fullName: "Admin",
  passwordHash: "hashed:old",
  roleId: adminRole.id,
  isActive: true,
};

const session = SessionContext.create("u1", "SUPER_ADMIN", []);

function build() {
  const users = new InMemoryUserRepository([user]);
  const audit = new CapturingAudit();
  const uc = new ChangePassword(users, new FakeHasher(), audit);
  return { uc, users, audit };
}

describe("ChangePassword", () => {
  it("re-hashes and audits when the old password verifies", async () => {
    const { uc, users, audit } = build();
    await uc.execute({ oldPassword: "old", newPassword: "new" }, session);
    expect((await users.findById("u1"))!.passwordHash).toBe("hashed:new");
    expect(audit.entries[0]).toMatchObject({
      action: "UPDATE",
      entity: "User",
    });
  });

  it("rejects a wrong current password", async () => {
    const { uc, users } = build();
    await expect(
      uc.execute({ oldPassword: "WRONG", newPassword: "new" }, session),
    ).rejects.toBeInstanceOf(AuthenticationError);
    expect((await users.findById("u1"))!.passwordHash).toBe("hashed:old");
  });

  it("rejects an empty new password", async () => {
    const { uc } = build();
    await expect(
      uc.execute({ oldPassword: "old", newPassword: "" }, session),
    ).rejects.toThrow(/must not be empty/);
  });

  it("only ever targets the session actor (identity from session)", async () => {
    const { uc, users } = build();
    const otherSession = SessionContext.create("ghost", "X", []);
    await expect(
      uc.execute({ oldPassword: "old", newPassword: "new" }, otherSession),
    ).rejects.toBeInstanceOf(AuthenticationError);
    // original user untouched
    expect((await users.findById("u1"))!.passwordHash).toBe("hashed:old");
  });

  it("is declared authenticatedOnly", () => {
    const { uc } = build();
    expect(uc.authenticatedOnly).toBe(true);
  });
});
