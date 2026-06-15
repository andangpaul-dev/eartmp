// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { AppShell } from "../../src/presentation/components/AppShell";
import { renderScreen } from "./harness";

const noop = () => {};

describe("AppShell navigation gating", () => {
  it("enables nav items the role can access and disables the rest", async () => {
    renderScreen(
      <AppShell route="students" setRoute={noop} onLock={noop}>
        <div>content</div>
      </AppShell>,
      { permissions: ["students.read"] },
    );

    expect(
      await screen.findByRole("button", { name: /students/i }),
    ).toBeEnabled();
    // No transcripts.read → the Transcripts nav item is locked.
    expect(screen.getByRole("button", { name: /transcripts/i })).toBeDisabled();
  });

  it("routes when an enabled nav item is clicked", async () => {
    const setRoute = vi.fn();
    const { user } = renderScreen(
      <AppShell route="students" setRoute={setRoute} onLock={noop}>
        <div>content</div>
      </AppShell>,
      { permissions: ["students.read"] },
    );

    // Dashboard has no permission requirement → always enabled.
    await user.click(await screen.findByRole("button", { name: /dashboard/i }));
    expect(setRoute).toHaveBeenCalledWith("dashboard");
  });

  it("shows the signing key as sealed by default", async () => {
    renderScreen(
      <AppShell route="dashboard" setRoute={noop} onLock={noop}>
        <div>content</div>
      </AppShell>,
      { permissions: ["transcripts.read"] },
    );
    expect(await screen.findByText(/key sealed/i)).toBeInTheDocument();
  });

  it("invokes onLock from the lock button", async () => {
    const onLock = vi.fn();
    const { user } = renderScreen(
      <AppShell route="dashboard" setRoute={noop} onLock={onLock}>
        <div>content</div>
      </AppShell>,
      { permissions: [] },
    );
    await user.click(await screen.findByTitle(/lock & sign out/i));
    expect(onLock).toHaveBeenCalled();
  });
});
