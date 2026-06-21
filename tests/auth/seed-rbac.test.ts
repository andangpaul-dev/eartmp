/**
 * Validates that the RBAC seed catalogue contains `results.override` and that
 * it is granted only to SUPER_ADMIN — not to FACULTY_OFFICER or DATA_ENTRY.
 *
 * Pure unit test: no database required. Imports the exported catalogue
 * constants directly from the seed module.
 */
import { describe, it, expect } from "vitest";
import { PERMISSIONS, ROLES } from "../../src/infrastructure/db/seed";

const permKeys = PERMISSIONS.map((p) => p.key);

function rolePermissions(name: string): string[] {
  const role = ROLES.find((r) => r.name === name);
  if (!role) throw new Error(`Role "${name}" not found in ROLES catalogue`);
  return role.permissions;
}

describe("RBAC catalogue — results.override", () => {
  it("is present in the PERMISSIONS catalogue", () => {
    expect(permKeys).toContain("results.override");
  });

  it("has a descriptive label in the catalogue", () => {
    const entry = PERMISSIONS.find((p) => p.key === "results.override");
    expect(entry).toBeDefined();
    expect(entry!.label.length).toBeGreaterThan(0);
  });

  it("is granted to SUPER_ADMIN", () => {
    expect(rolePermissions("SUPER_ADMIN")).toContain("results.override");
  });

  it("is NOT granted to FACULTY_OFFICER", () => {
    expect(rolePermissions("FACULTY_OFFICER")).not.toContain(
      "results.override",
    );
  });

  it("is NOT granted to DATA_ENTRY", () => {
    expect(rolePermissions("DATA_ENTRY")).not.toContain("results.override");
  });

  it("is NOT granted to REGISTRAR", () => {
    expect(rolePermissions("REGISTRAR")).not.toContain("results.override");
  });

  it("is NOT granted to VIEWER", () => {
    expect(rolePermissions("VIEWER")).not.toContain("results.override");
  });
});

describe("RBAC catalogue — students.manage (merge & bulk regen)", () => {
  it("is present in the PERMISSIONS catalogue with a label", () => {
    const entry = PERMISSIONS.find((p) => p.key === "students.manage");
    expect(entry).toBeDefined();
    expect(entry!.label.length).toBeGreaterThan(0);
  });

  it("is granted to SUPER_ADMIN (so Student Maintenance is reachable)", () => {
    expect(rolePermissions("SUPER_ADMIN")).toContain("students.manage");
  });
});

describe("RBAC catalogue integrity", () => {
  it("every permission a built-in role grants exists in the catalogue", () => {
    for (const role of ROLES) {
      for (const perm of role.permissions) {
        expect(
          permKeys,
          `role ${role.name} grants unknown "${perm}"`,
        ).toContain(perm);
      }
    }
  });
});
