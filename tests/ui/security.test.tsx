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
});
