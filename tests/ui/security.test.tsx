// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { SecurityScreen } from "../../src/presentation/screens/SecurityScreen";
import { renderScreen } from "./harness";

const perms = ["security.manage"];

describe("SecurityScreen", () => {
  it("shows a Create flow when no key is provisioned", async () => {
    const provisionSigningKey = vi.fn(async () => ({
      provisioned: true as const,
    }));
    const { user } = renderScreen(<SecurityScreen />, {
      permissions: perms,
      core: {
        keyStatus: async () => ({ provisioned: false, sealed: true }),
        provisionSigningKey,
      },
    });
    expect(await screen.findByText("Not provisioned")).toBeInTheDocument();
    const pass = await screen.findByLabelText(/^Passphrase/);
    const confirm = screen.getByLabelText(/Confirm passphrase/);
    await user.type(pass, "passphrase1");
    await user.type(confirm, "passphrase1");
    await user.click(screen.getByRole("button", { name: /create key/i }));
    await waitFor(() =>
      expect(provisionSigningKey).toHaveBeenCalledWith({
        passphrase: "passphrase1",
      }),
    );
  });

  it("requires the acknowledgement before replacing an existing key", async () => {
    const provisionSigningKey = vi.fn(async () => ({
      provisioned: true as const,
    }));
    const { user } = renderScreen(<SecurityScreen />, {
      permissions: perms,
      core: {
        keyStatus: async () => ({ provisioned: true, sealed: false }),
        provisionSigningKey,
      },
    });
    expect(await screen.findByText("Provisioned")).toBeInTheDocument();
    const pass = await screen.findByLabelText(/^Passphrase/);
    const confirm = screen.getByLabelText(/Confirm passphrase/);
    await user.type(pass, "passphrase1");
    await user.type(confirm, "passphrase1");
    const replaceBtn = screen.getByRole("button", { name: /replace key/i });
    expect(replaceBtn).toBeDisabled(); // not acknowledged yet
    await user.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(replaceBtn).toBeEnabled());
    await user.click(replaceBtn);
    await waitFor(() =>
      expect(provisionSigningKey).toHaveBeenCalledWith({
        passphrase: "passphrase1",
        replaceExisting: true,
      }),
    );
  });

  it("unseals the default key for this session (Phase F)", async () => {
    const unsealKey = vi.fn(async () => ({ sealed: false }));
    const { user } = renderScreen(<SecurityScreen />, {
      permissions: perms,
      core: {
        keyStatus: async () => ({ provisioned: true, sealed: true }),
        unsealKey,
      },
    });
    expect(
      await screen.findByText(/Unseal for this session/i),
    ).toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Signing key passphrase"),
      "open-sesame",
    );
    await user.click(screen.getByRole("button", { name: /^Unseal$/ }));
    await waitFor(() =>
      expect(unsealKey).toHaveBeenCalledWith({ passphrase: "open-sesame" }),
    );
  });

  it("unseals a selected institution's dedicated key, passing institutionId", async () => {
    const unsealKey = vi.fn(async () => ({ sealed: false }));
    const { user } = renderScreen(<SecurityScreen />, {
      permissions: perms,
      core: {
        listInstitutions: async () => [
          { id: "inst-b", name: "Univ B", calendarType: "SEMESTER" },
        ],
        keyStatus: async (input) => ({
          provisioned: true,
          sealed: true,
          ...(input?.institutionId
            ? { institutionId: input.institutionId }
            : {}),
        }),
        unsealKey,
      },
    });
    await user.selectOptions(
      await screen.findByLabelText(/Signing key scope/i),
      "inst-b",
    );
    await user.type(
      await screen.findByLabelText("Signing key passphrase"),
      "b-pass",
    );
    await user.click(
      screen.getByRole("button", { name: /Unseal institution key/i }),
    );
    await waitFor(() =>
      expect(unsealKey).toHaveBeenCalledWith({
        passphrase: "b-pass",
        institutionId: "inst-b",
      }),
    );
  });
});
