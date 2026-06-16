// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { RolesScreen } from "../../src/presentation/screens/RolesScreen";
import type { Role, Permission } from "../../src/presentation/runtime/contract";
import { renderScreen } from "./harness";

const perms: Permission[] = [
  { id: "p1", key: "students.read", label: "View students" },
  { id: "p2", key: "students.create", label: "Create students" },
];
const roles: Role[] = [{ id: "r1", name: "VIEWER", permissions: [perms[0]!] }];

const manage = ["roles.read", "roles.assign"];

describe("RolesScreen", () => {
  it("lists roles with their permission counts", async () => {
    renderScreen(<RolesScreen />, {
      permissions: manage,
      core: {
        listRoles: async () => roles,
        listPermissions: async () => perms,
      },
    });
    expect(await screen.findByText("VIEWER")).toBeInTheDocument();
  });

  it("edits a role's permission set", async () => {
    const setRolePermissions = vi.fn(async () => roles[0]!);
    const { user } = renderScreen(<RolesScreen />, {
      permissions: manage,
      core: {
        listRoles: async () => roles,
        listPermissions: async () => perms,
        setRolePermissions,
      },
    });
    await user.click(
      await screen.findByRole("button", { name: /permissions/i }),
    );
    // Toggle the second (currently unchecked) permission on.
    const create = await screen.findByText("students.create");
    await user.click(create);
    await user.click(screen.getByRole("button", { name: /save permissions/i }));
    await waitFor(() =>
      expect(setRolePermissions).toHaveBeenCalledWith(
        expect.objectContaining({
          roleId: "r1",
          permissionKeys: expect.arrayContaining([
            "students.read",
            "students.create",
          ]),
        }),
      ),
    );
  });

  it("hides write controls without roles.assign", async () => {
    renderScreen(<RolesScreen />, {
      permissions: ["roles.read"],
      core: {
        listRoles: async () => roles,
        listPermissions: async () => perms,
      },
    });
    expect(await screen.findByText("VIEWER")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /new role/i }),
    ).not.toBeInTheDocument();
  });
});
