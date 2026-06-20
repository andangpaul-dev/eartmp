// @vitest-environment jsdom
/**
 * Phase 10.3 — operator-confirmed identity-maintenance UI tests.
 * Tests must FAIL before the implementation exists (TDD).
 */
import { screen, waitFor, within } from "@testing-library/react";
import { StudentMaintenanceScreen } from "../../src/presentation/screens/StudentMaintenanceScreen";
import type { Faculty } from "../../src/presentation/runtime/contract";
import { renderScreen } from "./harness";

describe("StudentMaintenanceScreen", () => {
  it("lists duplicate candidates and merges after confirmation", async () => {
    const mergeStudents = vi.fn(async () => ({ ok: true as const }));
    const { user } = renderScreen(<StudentMaintenanceScreen />, {
      permissions: ["students.read", "students.manage"],
      core: {
        findDuplicateCandidates: async () => [
          {
            survivingId: "keep",
            duplicateId: "dup",
            reason: "exact name match",
          },
        ],
        mergeStudents,
      },
    });

    // Duplicate candidate row should be visible
    expect(await screen.findByText(/exact name match/i)).toBeInTheDocument();

    // Click the Merge button for this candidate
    await user.click(screen.getByRole("button", { name: /^merge$/i }));

    // Confirm dialog should appear
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();

    // Confirm the merge
    await user.click(within(dialog).getByRole("button", { name: /confirm/i }));

    await waitFor(() =>
      expect(mergeStudents).toHaveBeenCalledWith({
        survivingId: "keep",
        duplicateId: "dup",
      }),
    );
  });

  it("does NOT merge when the confirmation is cancelled", async () => {
    const mergeStudents = vi.fn(async () => ({ ok: true as const }));
    const { user } = renderScreen(<StudentMaintenanceScreen />, {
      permissions: ["students.read", "students.manage"],
      core: {
        findDuplicateCandidates: async () => [
          {
            survivingId: "keep",
            duplicateId: "dup",
            reason: "exact name match",
          },
        ],
        mergeStudents,
      },
    });

    await screen.findByText(/exact name match/i);

    // Click Merge
    await user.click(screen.getByRole("button", { name: /^merge$/i }));

    // Cancel the dialog
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

    // mergeStudents must NOT have been called
    expect(mergeStudents).not.toHaveBeenCalled();
  });

  it("bulk-regenerates after picking faculty + year and confirming", async () => {
    const faculties: Faculty[] = [{ id: "f1", name: "Science", code: "SCI" }];
    const bulkRegenerateMatricules = vi.fn(async () => ({
      regenerated: 5,
      skipped: ["s-skip"],
    }));
    const { user } = renderScreen(<StudentMaintenanceScreen />, {
      permissions: ["students.read", "students.manage"],
      core: {
        listFaculties: async () => faculties,
        bulkRegenerateMatricules,
      },
    });

    // Wait for faculty option to load, then select it
    await screen.findByRole("option", { name: "Science" });
    await user.selectOptions(screen.getByLabelText(/^faculty$/i), "f1");

    // Type the year
    await user.clear(screen.getByLabelText(/admission year/i));
    await user.type(screen.getByLabelText(/admission year/i), "2025");

    // Click "Regenerate all"
    await user.click(screen.getByRole("button", { name: /regenerate all/i }));

    // Confirm dialog
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /confirm/i }));

    await waitFor(() =>
      expect(bulkRegenerateMatricules).toHaveBeenCalledWith({
        facultyId: "f1",
        year: 2025,
      }),
    );

    // Result counts shown
    await screen.findByText(/regenerated/i);
    await screen.findByText(/5/);
  });

  it("hides the maintenance actions without students.manage", async () => {
    renderScreen(<StudentMaintenanceScreen />, {
      permissions: ["students.read"],
    });

    // Wait for initial render (heading is exact)
    await screen.findByRole("heading", { name: /maintenance/i });

    // Merge and Regenerate all controls must not be present
    expect(
      screen.queryByRole("button", { name: /^merge$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /regenerate all/i }),
    ).not.toBeInTheDocument();
  });
});
