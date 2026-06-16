import { describe, it, expect } from "vitest";
import {
  CreateUser,
  DeactivateUser,
  ActivateUser,
  AssignRole,
  ResetUserPassword,
  ListUsers,
  ListRoles,
} from "../../src/application/use-cases/auth/ManageUsers";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { AuthorizationError } from "../../src/domain/errors/auth";
import type { UserAccount } from "../../src/domain/entities/auth";
import {
  FakeHasher,
  CapturingAudit,
  InMemoryUserRepository,
  InMemoryRoleRepository,
  adminRole,
  viewerRole,
} from "./fakes";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "users.create",
  "users.update",
  "users.read",
  "roles.assign",
  "roles.read",
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

const roles = () => new InMemoryRoleRepository([adminRole, viewerRole]);

describe("CreateUser", () => {
  it("hashes the password, persists, and audits", async () => {
    const users = new InMemoryUserRepository();
    const audit = new CapturingAudit();
    const uc = new CreateUser(users, roles(), new FakeHasher(), audit);
    const created = await uc.execute(
      {
        username: "carol",
        email: "c@e.edu",
        fullName: "Carol",
        roleId: "role-viewer",
        password: "password1",
      },
      admin,
    );
    expect(created.passwordHash).toBe("hashed:password1"); // never plaintext
    expect(created.isActive).toBe(true);
    expect(audit.entries[0]).toMatchObject({
      action: "CREATE",
      entity: "User",
    });
  });

  it("rejects a short password, a duplicate username, and an unknown role", async () => {
    const users = new InMemoryUserRepository([existing]);
    const uc = new CreateUser(
      users,
      roles(),
      new FakeHasher(),
      new CapturingAudit(),
    );
    const base = { email: "x@e.edu", fullName: "X", roleId: "role-viewer" };
    await expect(
      uc.execute({ ...base, username: "amy", password: "short" }, admin),
    ).rejects.toThrow(/at least 8/);
    await expect(
      uc.execute({ ...base, username: "bob", password: "password1" }, admin),
    ).rejects.toThrow(/already exists/);
    await expect(
      uc.execute(
        { ...base, username: "amy", roleId: "nope", password: "password1" },
        admin,
      ),
    ).rejects.toThrow(/role does not exist/);
  });

  it("attaches the offending input name to validation errors (form fields)", async () => {
    const users = new InMemoryUserRepository([existing]);
    const uc = new CreateUser(
      users,
      roles(),
      new FakeHasher(),
      new CapturingAudit(),
    );
    const base = { email: "x@e.edu", fullName: "X", roleId: "role-viewer" };
    await expect(
      uc.execute({ ...base, username: "ab", password: "password1" }, admin),
    ).rejects.toMatchObject({ fields: { username: expect.any(String) } });
    await expect(
      uc.execute({ ...base, username: "amy", password: "short" }, admin),
    ).rejects.toMatchObject({ fields: { password: expect.any(String) } });
    await expect(
      uc.execute(
        { ...base, username: "amy", roleId: "nope", password: "password1" },
        admin,
      ),
    ).rejects.toMatchObject({ fields: { roleId: expect.any(String) } });
  });

  it("is denied through the seam without users.create", async () => {
    const uc = new CreateUser(
      new InMemoryUserRepository(),
      roles(),
      new FakeHasher(),
      new CapturingAudit(),
    );
    await expect(
      authorize(
        uc,
        {
          username: "amy",
          email: "x@e.edu",
          fullName: "X",
          roleId: "role-viewer",
          password: "password1",
        },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("DeactivateUser / ActivateUser", () => {
  it("deactivates then reactivates, auditing each", async () => {
    const users = new InMemoryUserRepository([existing]);
    const audit = new CapturingAudit();
    await new DeactivateUser(users, audit).execute({ userId: "u1" }, admin);
    expect((await users.findById("u1"))!.isActive).toBe(false);
    await new ActivateUser(users, audit).execute({ userId: "u1" }, admin);
    expect((await users.findById("u1"))!.isActive).toBe(true);
  });

  it("refuses to deactivate your own account", async () => {
    const self: UserAccount = { ...existing, id: "admin", username: "admin" };
    const users = new InMemoryUserRepository([self]);
    await expect(
      new DeactivateUser(users, new CapturingAudit()).execute(
        { userId: "admin" },
        admin,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("AssignRole", () => {
  it("changes the user's role and audits", async () => {
    const users = new InMemoryUserRepository([existing]);
    const audit = new CapturingAudit();
    await new AssignRole(users, roles(), audit).execute(
      { userId: "u1", roleId: "role-admin" },
      admin,
    );
    expect((await users.findById("u1"))!.roleId).toBe("role-admin");
  });

  it("rejects an unknown role", async () => {
    const users = new InMemoryUserRepository([existing]);
    await expect(
      new AssignRole(users, roles(), new CapturingAudit()).execute(
        { userId: "u1", roleId: "nope" },
        admin,
      ),
    ).rejects.toThrow(/role does not exist/);
  });

  it("requires roles.assign through the seam", async () => {
    const uc = new AssignRole(
      new InMemoryUserRepository([existing]),
      roles(),
      new CapturingAudit(),
    );
    await expect(
      authorize(uc, { userId: "u1", roleId: "role-admin" }, viewer),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("ResetUserPassword", () => {
  it("rehashes and audits, rejecting a short password", async () => {
    const users = new InMemoryUserRepository([existing]);
    const audit = new CapturingAudit();
    const uc = new ResetUserPassword(users, new FakeHasher(), audit);
    await uc.execute({ userId: "u1", newPassword: "newpass12" }, admin);
    expect((await users.findById("u1"))!.passwordHash).toBe("hashed:newpass12");
    await expect(
      uc.execute({ userId: "u1", newPassword: "x" }, admin),
    ).rejects.toThrow(/at least 8/);
  });
});

describe("ListUsers / ListRoles", () => {
  it("lists users with role names and no password hash", async () => {
    const users = new InMemoryUserRepository([existing]);
    const list = await new ListUsers(users, roles()).execute({}, admin);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ username: "bob", roleName: "VIEWER" });
    expect("passwordHash" in list[0]!).toBe(false);
  });

  it("lists roles", async () => {
    const list = await new ListRoles(roles()).execute({}, admin);
    expect(list.map((r) => r.name).sort()).toEqual(["SUPER_ADMIN", "VIEWER"]);
  });
});
