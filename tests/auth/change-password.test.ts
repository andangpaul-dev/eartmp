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
    await uc.execute({ oldPassword: "old", newPassword: "newpass12" }, session);
    expect((await users.findById("u1"))!.passwordHash).toBe("hashed:newpass12");
    expect(audit.entries[0]).toMatchObject({
      action: "UPDATE",
      entity: "User",
    });
  });

  it("rejects a wrong current password", async () => {
    const { uc, users } = build();
    await expect(
      uc.execute(
        { oldPassword: "WRONGPW1", newPassword: "newpass12" },
        session,
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
    expect((await users.findById("u1"))!.passwordHash).toBe("hashed:old");
  });

  it("rejects a too-short new password and an unchanged password", async () => {
    const { uc } = build();
    await expect(
      uc.execute({ oldPassword: "old", newPassword: "short" }, session),
    ).rejects.toThrow(/at least 8/);
    await expect(
      uc.execute(
        { oldPassword: "samepass1", newPassword: "samepass1" },
        session,
      ),
    ).rejects.toThrow(/differ from the current/);
  });

  it("only ever targets the session actor (identity from session)", async () => {
    const { uc, users } = build();
    const otherSession = SessionContext.create("ghost", "X", []);
    await expect(
      uc.execute(
        { oldPassword: "old", newPassword: "newpass12" },
        otherSession,
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
    // original user untouched
    expect((await users.findById("u1"))!.passwordHash).toBe("hashed:old");
  });

  it("is declared authenticatedOnly", () => {
    const { uc } = build();
    expect(uc.authenticatedOnly).toBe(true);
  });
});
