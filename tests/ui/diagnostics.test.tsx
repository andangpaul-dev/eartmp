// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { DiagnosticsScreen } from "../../src/presentation/screens/DiagnosticsScreen";
import { renderScreen } from "./harness";

const core = {
  lockState: async () => ({ locked: false, required: true }),
  keyState: async () => ({ sealed: true }),
  verifyAuditChain: async () => ({ valid: true, checked: 10, total: 10 }),
};

describe("DiagnosticsScreen", () => {
  it("shows version, DB, key and audit-chain health for a permitted operator", async () => {
    renderScreen(<DiagnosticsScreen />, {
      permissions: ["transcripts.read", "audit.read"],
      core,
    });
    expect(await screen.findByText("App version")).toBeInTheDocument();
    // DB encrypted + open, key sealed, audit chain intact.
    expect(await screen.findByText(/Open · encrypted/)).toBeInTheDocument();
    expect(await screen.findByText("Sealed")).toBeInTheDocument();
    expect(await screen.findByText(/Intact \(10\/10\)/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /copy diagnostics/i }),
    ).toBeInTheDocument();
  });

  it("hides permission-gated rows (shows —) without the permission", async () => {
    renderScreen(<DiagnosticsScreen />, { permissions: [], core });
    await screen.findByText("App version");
    // No transcripts.read / audit.read → key + audit rows render a dash.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Sealed")).not.toBeInTheDocument();
  });
});
