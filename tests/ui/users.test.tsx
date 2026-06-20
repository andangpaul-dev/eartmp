// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { UsersScreen } from "../../src/presentation/screens/UsersScreen";
import type {
  UserSummary,
  Role,
} from "../../src/presentation/runtime/contract";
import { CoreApiError } from "../../src/presentation/runtime/ipcClient";
import { renderScreen } from "./harness";

const user = (over: Partial<UserSummary> = {}): UserSummary => ({
  id: "u1",
  username: "bob",
  email: "b@e.edu",
  fullName: "Bob Builder",
  roleId: "r-viewer",
  roleName: "VIEWER",
  isActive: true,
  facultyIds: [],
  ...over,
});

const roles: Role[] = [
  { id: "r-admin", name: "SUPER_ADMIN", permissions: [] },
  { id: "r-viewer", name: "VIEWER", permissions: [] },
];

const adminPerms = [
  "users.read",
  "users.create",
  "users.update",
  "roles.read",
  "roles.assign",
];

describe("UsersScreen", () => {
  it("lists users with role and status", async () => {
    renderScreen(<UsersScreen />, {
      permissions: adminPerms,
      core: { listUsers: async () => [user()], listRoles: async () => roles },
    });
    expect(await screen.findByText("Bob Builder")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("creates a user through createUser", async () => {
    const createUser = vi.fn(async () => ({ id: "u-new" }));
    const { user: u } = renderScreen(<UsersScreen />, {
      permissions: adminPerms,
      core: {
        listUsers: async () => [],
        listRoles: async () => roles,
        createUser,
      },
    });
    await u.click(await screen.findByRole("button", { name: /new user/i }));
    await u.type(await screen.findByLabelText(/username/i), "carol");
    await u.type(screen.getByLabelText(/full name/i), "Carol Coder");
    await u.type(screen.getByLabelText(/email/i), "c@e.edu");
    await u.type(screen.getByLabelText(/temporary password/i), "password1");
    await u.click(screen.getByRole("button", { name: /^create user$/i }));
    await waitFor(() =>
      expect(createUser).toHaveBeenCalledWith(
        expect.objectContaining({ username: "carol", roleId: "r-admin" }),
      ),
    );
  });

  it("shows a per-field error when createUser rejects with fields", async () => {
    const createUser = vi.fn(async () => {
      throw new CoreApiError({
        code: "VALIDATION",
        message: 'Username "carol" already exists.',
        fields: { username: 'Username "carol" already exists.' },
      });
    });
    const { user: u } = renderScreen(<UsersScreen />, {
      permissions: adminPerms,
      core: {
        listUsers: async () => [],
        listRoles: async () => roles,
        createUser,
      },
    });
    await u.click(await screen.findByRole("button", { name: /new user/i }));
    await u.type(await screen.findByLabelText(/username/i), "carol");
    await u.type(screen.getByLabelText(/full name/i), "Carol Coder");
    await u.type(screen.getByLabelText(/email/i), "c@e.edu");
    await u.type(screen.getByLabelText(/temporary password/i), "password1");
    await u.click(screen.getByRole("button", { name: /^create user$/i }));
    // The message renders inline on the Username field (.err inside its label).
    const err = await screen.findByText(/already exists/i);
    expect(err).toHaveClass("err");
  });

  it("assigns faculty access through setUserFaculties on edit", async () => {
    const setUserFaculties = vi.fn(async () => ({ ok: true as const }));
    const { user: u } = renderScreen(<UsersScreen />, {
      permissions: adminPerms,
      core: {
        listUsers: async () => [user({ facultyIds: ["f1"] })],
        listRoles: async () => roles,
        listFaculties: async () => [
          { id: "f1", code: "SCI", name: "Science" } as never,
          { id: "f2", code: "ART", name: "Arts" } as never,
        ],
        updateUserDetails: async () => ({ id: "u1" }),
        setUserFaculties,
      },
    });
    await u.click(await screen.findByRole("button", { name: /edit/i }));
    // f1 starts checked; tick f2 too, then save.
    await u.click(await screen.findByRole("checkbox", { name: /Arts/i }));
    await u.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(setUserFaculties).toHaveBeenCalledWith({
        userId: "u1",
        facultyIds: ["f1", "f2"],
      }),
    );
  });

  it("disables Deactivate for your own account", async () => {
    renderScreen(<UsersScreen />, {
      permissions: adminPerms,
      core: {
        // the session userId in the harness is "u-test"
        listUsers: async () => [user({ id: "u-test", username: "admin" })],
        listRoles: async () => roles,
      },
    });
    const btn = await screen.findByRole("button", { name: /deactivate/i });
    expect(btn).toBeDisabled();
  });

  it("hides New user without users.create", async () => {
    renderScreen(<UsersScreen />, {
      permissions: ["users.read"],
      core: { listUsers: async () => [user()] },
    });
    await screen.findByText("Bob Builder");
    expect(
      screen.queryByRole("button", { name: /new user/i }),
    ).not.toBeInTheDocument();
  });
});
