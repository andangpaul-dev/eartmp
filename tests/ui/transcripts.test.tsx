// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { TranscriptsScreen } from "../../src/presentation/screens/TranscriptsScreen";
import { renderScreen } from "./harness";

describe("TranscriptsScreen signing-key UX", () => {
  it("shows the sealed banner and an Unseal action for a generator", async () => {
    renderScreen(<TranscriptsScreen />, {
      permissions: ["transcripts.read", "transcripts.generate"],
    });
    expect(
      await screen.findByText(/signing key is sealed/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /unseal key/i }),
    ).toBeInTheDocument();
  });

  it("hides the Unseal action without transcripts.generate", async () => {
    renderScreen(<TranscriptsScreen />, {
      permissions: ["transcripts.read"],
    });
    await screen.findByText(/signing key is sealed/i);
    expect(
      screen.queryByRole("button", { name: /unseal key/i }),
    ).not.toBeInTheDocument();
  });

  it("unseals with the passphrase and flips the banner", async () => {
    const unsealKey = vi.fn(async () => ({ sealed: false }));
    const { user } = renderScreen(<TranscriptsScreen />, {
      permissions: ["transcripts.read", "transcripts.generate"],
      core: { unsealKey },
    });

    await user.click(
      await screen.findByRole("button", { name: /unseal key/i }),
    );
    await user.type(
      await screen.findByLabelText(/institution passphrase/i),
      "eartmp-dev-passphrase",
    );
    await user.click(screen.getByRole("button", { name: "Unseal" }));

    await waitFor(() =>
      expect(unsealKey).toHaveBeenCalledWith({
        passphrase: "eartmp-dev-passphrase",
      }),
    );
    expect(
      await screen.findByText(/signing key is unsealed/i),
    ).toBeInTheDocument();
  });
});
