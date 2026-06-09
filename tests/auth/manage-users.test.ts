import { describe, it, expect } from "vitest";
import {
  CreateUser,
  DeactivateUser,
  AssignRole,
} from "../../src/application/use-cases/auth/ManageUsers";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { AuthorizationError } from "../../src/domain/errors/auth";
import type { UserAccount } from "../../src/domain/entities/auth";
import { FakeHasher, CapturingAudit, InMemoryUserRepository } from "./fakes";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "users.create",
  "users.update",
  "roles.assign",
]);
const viewer = SessionContext.create("v", "VIEWER", ["students.read"]);

const existing: UserAccount = {
  id: "u1",
  username: "bob",
  email: "b@e.edu",
  fullName: "Bob",
  passwordHash: "hashed:x",
  roleId: "role-viewer",
  isActive: true,
};

describe("CreateUser", () => {
  it("hashes the password, persists, and audits", async () => {
    const users = new InMemoryUserRepository();
    const audit = new CapturingAudit();
    const uc = new CreateUser(users, new FakeHasher(), audit);
    const created = await uc.execute(
      {
        username: "carol",
        email: "c@e.edu",
        fullName: "Carol",
        roleId: "role-viewer",
        password: "pw",
      },
      admin,
    );
    expect(created.passwordHash).toBe("hashed:pw"); // never plaintext
    expect(created.isActive).toBe(true);
    expect(audit.entries[0]).toMatchObject({
      action: "CREATE",
      entity: "User",
    });
  });

  it("is denied through the seam without users.create", async () => {
    const uc = new CreateUser(
      new InMemoryUserRepository(),
      new FakeHasher(),
      new CapturingAudit(),
    );
    await expect(
      authorize(
        uc,
        {
          username: "x",
          email: "x@e.edu",
          fullName: "X",
          roleId: "r",
          password: "p",
        },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("DeactivateUser", () => {
  it("sets isActive false and audits", async () => {
    const users = new InMemoryUserRepository([existing]);
    const audit = new CapturingAudit();
    const uc = new DeactivateUser(users, audit);
    await uc.execute({ userId: "u1" }, admin);
    expect((await users.findById("u1"))!.isActive).toBe(false);
    expect(audit.entries[0]).toMatchObject({
      action: "UPDATE",
      entity: "User",
    });
  });
});

describe("AssignRole", () => {
  it("changes the user's role and audits", async () => {
    const users = new InMemoryUserRepository([existing]);
    const audit = new CapturingAudit();
    const uc = new AssignRole(users, audit);
    await uc.execute({ userId: "u1", roleId: "role-admin" }, admin);
    expect((await users.findById("u1"))!.roleId).toBe("role-admin");
    expect(audit.entries[0]).toMatchObject({
      action: "UPDATE",
      entity: "User",
    });
  });

  it("requires roles.assign through the seam", async () => {
    const uc = new AssignRole(
      new InMemoryUserRepository([existing]),
      new CapturingAudit(),
    );
    await expect(
      authorize(uc, { userId: "u1", roleId: "role-admin" }, viewer),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
