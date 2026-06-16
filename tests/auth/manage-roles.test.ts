import { describe, it, expect, beforeEach } from "vitest";
import {
  CreateRole,
  UpdateRole,
  DeleteRole,
  SetRolePermissions,
  ListPermissions,
} from "../../src/application/use-cases/auth/ManageRoles";
import { UpdateUserDetails } from "../../src/application/use-cases/auth/ManageUsers";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import type { Permission } from "../../src/domain/entities/auth";
import type { PermissionRepository } from "../../src/domain/repositories/auth";
import {
  CapturingAudit,
  InMemoryRoleRepository,
  InMemoryUserRepository,
  adminRole,
} from "./fakes";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "roles.assign",
  "roles.read",
  "users.update",
]);
const viewer = SessionContext.create("v", "VIEWER", ["roles.read"]);

let roles: InMemoryRoleRepository;
let audit: CapturingAudit;
beforeEach(() => {
  roles = new InMemoryRoleRepository([adminRole]);
  audit = new CapturingAudit();
});

describe("Role administration", () => {
  it("creates a custom role with an initial permission set", async () => {
    const role = await new CreateRole(roles, audit).execute(
      {
        name: "REGISTRAR",
        description: "Records office",
        permissionKeys: ["students.read"],
      },
      admin,
    );
    expect(role.name).toBe("REGISTRAR");
    expect(role.permissions.map((p) => p.key)).toEqual(["students.read"]);
    expect(audit.entries.at(-1)).toMatchObject({
      entity: "Role",
      action: "CREATE",
    });
  });

  it("rejects a duplicate role name", async () => {
    await expect(
      new CreateRole(roles, audit).execute({ name: "SUPER_ADMIN" }, admin),
    ).rejects.toThrow(/already exists/);
  });

  it("renames a role", async () => {
    const r = await new CreateRole(roles, audit).execute(
      { name: "TEMP" },
      admin,
    );
    const renamed = await new UpdateRole(roles, audit).execute(
      { id: r.id, patch: { name: "FINAL" } },
      admin,
    );
    expect(renamed.name).toBe("FINAL");
  });

  it("refuses to delete a role with users, then deletes when empty", async () => {
    const r = await new CreateRole(roles, audit).execute(
      { name: "TEMP" },
      admin,
    );
    roles.users = 1;
    await expect(
      new DeleteRole(roles, audit).execute({ id: r.id }, admin),
    ).rejects.toThrow(/still has users/);
    roles.users = 0;
    await new DeleteRole(roles, audit).execute({ id: r.id }, admin);
    expect(await roles.findById(r.id)).toBeNull();
  });

  it("replaces a role's permission set", async () => {
    const updated = await new SetRolePermissions(roles, audit).execute(
      {
        roleId: adminRole.id,
        permissionKeys: ["students.read", "results.read", "roles.assign"],
      },
      admin,
    );
    expect(updated.permissions.map((p) => p.key).sort()).toEqual([
      "results.read",
      "roles.assign",
      "students.read",
    ]);
  });

  it("refuses to remove the LAST roles.assign (anti-lockout)", async () => {
    // adminRole is the only role and holds roles.assign.
    await expect(
      new SetRolePermissions(roles, audit).execute(
        { roleId: adminRole.id, permissionKeys: ["students.read"] },
        admin,
      ),
    ).rejects.toThrow(/roles\.assign/);
  });

  it("allows removing roles.assign when another role still has it", async () => {
    await new CreateRole(roles, audit).execute(
      { name: "MANAGER", permissionKeys: ["roles.assign"] },
      admin,
    );
    const updated = await new SetRolePermissions(roles, audit).execute(
      { roleId: adminRole.id, permissionKeys: ["students.read"] },
      admin,
    );
    expect(updated.permissions.map((p) => p.key)).toEqual(["students.read"]);
  });

  it("lists the permission catalogue (roles.read), denied otherwise", async () => {
    const all: Permission[] = [
      { id: "p1", key: "students.read", label: "View students" },
    ];
    const perms = {
      async findAll() {
        return all;
      },
    } as PermissionRepository;
    expect(await new ListPermissions(perms).execute({}, admin)).toEqual(all);
    await expect(
      authorize(new CreateRole(roles, audit), { name: "X" }, viewer),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("UpdateUserDetails", () => {
  it("edits username/email/fullName and rejects a taken username", async () => {
    const users = new InMemoryUserRepository([
      {
        id: "u1",
        username: "bob",
        email: "b@e.edu",
        fullName: "Bob",
        passwordHash: "h",
        roleId: "role-admin",
        isActive: true,
      },
      {
        id: "u2",
        username: "amy",
        email: "a@e.edu",
        fullName: "Amy",
        passwordHash: "h",
        roleId: "role-admin",
        isActive: true,
      },
    ]);
    const uc = new UpdateUserDetails(users, audit);
    const updated = await uc.execute(
      { userId: "u1", patch: { fullName: "Bob Builder", email: "bob@e.edu" } },
      admin,
    );
    expect(updated.fullName).toBe("Bob Builder");
    await expect(
      uc.execute({ userId: "u1", patch: { username: "amy" } }, admin),
    ).rejects.toThrow(/already exists/);
  });
});
