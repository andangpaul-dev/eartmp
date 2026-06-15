// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { AuditScreen } from "../../src/presentation/screens/AuditScreen";
import type { AuditEntry } from "../../src/presentation/runtime/contract";
import { renderScreen } from "./harness";

const entry = (over: Partial<AuditEntry> = {}): AuditEntry =>
  ({
    id: "a1",
    userId: "admin",
    action: "GENERATE",
    entity: "Transcript",
    recordId: "t-12345678",
    createdAt: "2026-01-01T10:00:00.000Z",
    hash: "abc123",
    ...over,
  }) as AuditEntry;

describe("AuditScreen", () => {
  it("shows the empty state when the trail is empty", async () => {
    renderScreen(<AuditScreen />, { permissions: ["audit.read"] });
    expect(await screen.findByText(/no audit entries/i)).toBeInTheDocument();
  });

  it("renders audit rows with action and entity", async () => {
    renderScreen(<AuditScreen />, {
      permissions: ["audit.read"],
      core: { getAuditLog: async () => ({ items: [entry()], total: 1 }) },
    });
    expect(await screen.findByText("GENERATE")).toBeInTheDocument();
    expect(screen.getByText("Transcript")).toBeInTheDocument();
  });

  it("reports an intact chain prominently after Verify", async () => {
    const verifyAuditChain = vi.fn(async () => ({ valid: true, checked: 42 }));
    const { user } = renderScreen(<AuditScreen />, {
      permissions: ["audit.read"],
      core: { verifyAuditChain },
    });
    await user.click(
      await screen.findByRole("button", { name: /verify chain/i }),
    );
    await waitFor(() => expect(verifyAuditChain).toHaveBeenCalled());
    expect(await screen.findByText(/chain intact/i)).toBeInTheDocument();
    expect(screen.getByText(/42 linked entries/i)).toBeInTheDocument();
  });

  it("flags a broken chain with the break location", async () => {
    const verifyAuditChain = vi.fn(async () => ({
      valid: false,
      checked: 7,
      brokenAt: { index: 8, id: "a-bad", reason: "content" as const },
    }));
    const { user } = renderScreen(<AuditScreen />, {
      permissions: ["audit.read"],
      core: { verifyAuditChain },
    });
    await user.click(
      await screen.findByRole("button", { name: /verify chain/i }),
    );
    expect(await screen.findByText(/chain broken/i)).toBeInTheDocument();
    expect(screen.getByText(/#8/)).toBeInTheDocument();
  });
});
