// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { isDatabaseLockedError } from "../../src/presentation/components/DatabaseLockedHelp";
import { LoginScreen } from "../../src/presentation/screens/LoginScreen";
import { DiagnosticsScreen } from "../../src/presentation/screens/DiagnosticsScreen";
import { renderScreen } from "./harness";

// ---------------------------------------------------------------------------
// Unit tests — isDatabaseLockedError
// ---------------------------------------------------------------------------
describe("isDatabaseLockedError", () => {
  it('returns true for "Database is locked"', () => {
    expect(isDatabaseLockedError("Database is locked")).toBe(true);
  });

  it('returns true for lowercase "database is locked"', () => {
    expect(isDatabaseLockedError("database is locked")).toBe(true);
  });

  it('returns true for "SQLITE_BUSY"', () => {
    expect(isDatabaseLockedError("SQLITE_BUSY")).toBe(true);
  });

  it('returns false for "bad password"', () => {
    expect(isDatabaseLockedError("bad password")).toBe(false);
  });

  it('does NOT match a generic "is locked" (e.g. account locked)', () => {
    expect(isDatabaseLockedError("Account is locked after 5 attempts")).toBe(
      false,
    );
  });

  it("returns false for undefined", () => {
    expect(isDatabaseLockedError(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration — LoginScreen shows recovery guide + Retry on SQLITE_BUSY
// ---------------------------------------------------------------------------
describe("LoginScreen — database locked recovery", () => {
  it("shows the recovery guide and a Retry button when login throws a database-locked error", async () => {
    let callCount = 0;
    const login = vi.fn(async () => {
      callCount += 1;
      throw new Error("Database is locked");
    });

    const { user } = renderScreen(<LoginScreen />, { core: { login } });

    await user.click(await screen.findByRole("button", { name: /sign in/i }));

    // Recovery guide visible
    expect(
      await screen.findByText(/close all eartmp windows/i),
    ).toBeInTheDocument();

    // Retry button visible
    const retryBtn = await screen.findByRole("button", { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();

    // Clicking Retry calls login again
    await user.click(retryBtn);
    await waitFor(() => expect(callCount).toBeGreaterThanOrEqual(2));
  });
});

// ---------------------------------------------------------------------------
// Integration — DiagnosticsScreen has a static "database is locked" entry
// ---------------------------------------------------------------------------
describe("DiagnosticsScreen — database locked troubleshooting", () => {
  it('shows a "Database is locked" troubleshooting section', async () => {
    renderScreen(<DiagnosticsScreen />, {
      permissions: [],
      core: {
        lockState: async () => ({ locked: false, required: false }),
        keyState: async () => ({ sealed: true }),
        verifyAuditChain: async () => ({
          valid: true,
          checked: 0,
          total: 0,
        }),
      },
    });

    expect(await screen.findByText(/database is locked/i)).toBeInTheDocument();
  });
});
