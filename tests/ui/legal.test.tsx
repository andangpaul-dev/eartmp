// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { LegalScreen } from "../../src/presentation/screens/LegalScreen";
import { renderScreen } from "./harness";

describe("LegalScreen", () => {
  it("shows the Terms by default and switches documents via the tabs", async () => {
    const { user } = renderScreen(<LegalScreen />, { permissions: [] });

    // Terms is the default document.
    expect(
      await screen.findByText(/Terms & Conditions of Use/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Licence and permitted use/i)).toBeInTheDocument();

    // Switch to the Disclaimer.
    await user.click(screen.getByRole("button", { name: /^Disclaimer$/i }));
    expect(await screen.findByText(/Provided .as is./i)).toBeInTheDocument();

    // Switch to the User Policies.
    await user.click(screen.getByRole("button", { name: /User Policies/i }));
    expect(
      await screen.findByText(/Account and key security/i),
    ).toBeInTheDocument();
  });

  it("renders bullet lists from '- ' lines", async () => {
    renderScreen(<LegalScreen />, { permissions: [] });
    // Terms' first section has bullets.
    const bullets = await screen.findAllByRole("listitem");
    expect(bullets.length).toBeGreaterThan(0);
  });
});
