// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { BackupScreen } from "../../src/presentation/screens/BackupScreen";
import { renderScreen } from "./harness";

const envelope = {
  manifest: {
    formatVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    salt: "",
    iv: "",
    authTag: "",
    checksum: "",
    tables: {},
  },
  ciphertext: "cipher",
};

beforeAll(() => {
  // jsdom lacks object-URL APIs the download path uses.
  Object.defineProperty(URL, "createObjectURL", {
    value: () => "blob:x",
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: () => {},
    configurable: true,
  });
});

async function loadFileAndPass(
  user: ReturnType<typeof renderScreen>["user"],
): Promise<void> {
  const file = new File([JSON.stringify(envelope)], "backup.json", {
    type: "application/json",
  });
  await user.upload(await screen.findByLabelText("Backup file"), file);
  await waitFor(() => screen.getByText(/Loaded: backup.json/));
  await user.type(screen.getByLabelText(/^Backup passphrase$/), "open-sesame");
}

describe("BackupScreen", () => {
  it("creates a backup with a confirmed passphrase", async () => {
    const createBackup = vi.fn(async () => envelope as never);
    const { user } = renderScreen(<BackupScreen />, {
      permissions: ["backup.create"],
      core: { createBackup },
    });
    await user.type(
      await screen.findByLabelText(/Backup passphrase \(min/),
      "passphrase1",
    );
    await user.type(screen.getByLabelText(/Confirm passphrase/), "passphrase1");
    await user.click(
      screen.getByRole("button", { name: /create .* download backup/i }),
    );
    await waitFor(() =>
      expect(createBackup).toHaveBeenCalledWith({ passphrase: "passphrase1" }),
    );
  });

  it("verifies a loaded backup (non-destructive) and shows the result", async () => {
    const verifyBackup = vi.fn(async () => ({
      valid: true as const,
      tables: 2,
      rows: 5,
      createdAt: "2026-01-01T00:00:00.000Z",
    }));
    const { user } = renderScreen(<BackupScreen />, {
      permissions: ["backup.create"],
      core: { verifyBackup },
    });
    await loadFileAndPass(user);
    await user.click(screen.getByRole("button", { name: /verify \(safe\)/i }));
    await waitFor(() =>
      expect(verifyBackup).toHaveBeenCalledWith({
        envelope,
        passphrase: "open-sesame",
      }),
    );
    expect(
      await screen.findByText(/Restorable — 2 tables, 5 rows/),
    ).toBeInTheDocument();
  });

  it("restores only after the typed confirmation", async () => {
    const restoreBackup = vi.fn(async () => ({ tables: 2, rows: 5 }));
    const { user } = renderScreen(<BackupScreen />, {
      permissions: ["backup.create", "backup.restore"],
      core: { restoreBackup },
    });
    await loadFileAndPass(user);
    await user.click(
      screen.getByRole("button", { name: /restore \(replace all data\)/i }),
    );
    // Confirmation modal → commit.
    await user.click(
      await screen.findByRole("button", { name: /verify & restore/i }),
    );
    await waitFor(() =>
      expect(restoreBackup).toHaveBeenCalledWith({
        envelope,
        passphrase: "open-sesame",
      }),
    );
  });
});
