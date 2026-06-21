// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { ConfigurationScreen } from "../../src/presentation/screens/ConfigurationScreen";
import type {
  StoredGradeScale,
  StoredAssessmentConfig,
} from "../../src/presentation/runtime/contract";
import { renderScreen } from "./harness";

/** Build a minimal StoredGradeScale with JSON-serialised bands. */
function makeScale(
  overrides: Partial<StoredGradeScale> = {},
): StoredGradeScale {
  return {
    id: "gs-1",
    name: "Standard",
    bands: JSON.stringify([
      { minMark: 0, maxMark: 39, grade: "F", gradePoint: 0, isPass: false },
      { minMark: 40, maxMark: 100, grade: "A", gradePoint: 4, isPass: true },
    ]),
    isDefault: false,
    ...overrides,
  };
}

/** Navigate to the Grading tab. */
async function openGradingTab(
  user: ReturnType<typeof import("@testing-library/user-event").default.setup>,
) {
  // The Institution tab is the default; wait for it to load, then switch.
  await screen.findByRole("tab", { name: /grading/i });
  await user.click(screen.getByRole("tab", { name: /grading/i }));
  // Wait for the Grade scales card heading.
  await screen.findByText("Grade scales");
}

describe("GradeScaleEditorModal", () => {
  it("creates a grade scale from the bands editor", async () => {
    const createGradeScale = vi.fn(async () =>
      makeScale({ id: "gs-new", name: "My Scale" }),
    );
    const { user } = renderScreen(<ConfigurationScreen />, {
      permissions: ["config.read", "config.manage", "institution.manage"],
      core: {
        getInstitution: async () =>
          ({ id: "i1", name: "Test Uni", calendarType: "SEMESTER" }) as never,
        listGradeScales: async () => [],
        createGradeScale,
      },
    });

    await openGradingTab(user);

    // Open the New scale modal
    await user.click(await screen.findByRole("button", { name: /new scale/i }));

    // Fill in the name
    const nameInput = await screen.findByLabelText(/scale name/i);
    await user.clear(nameInput);
    await user.type(nameInput, "My Scale");

    // The modal should have at least one band row. Adjust minMark to 0, maxMark to 100,
    // grade to A, gradePoint to 4. We target the first row's inputs by their accessible labels.
    // First clear existing default values and set them correctly.
    const minMarkInputs = await screen.findAllByLabelText(/min mark/i);
    const maxMarkInputs = await screen.findAllByLabelText(/max mark/i);
    const gradeInputs = await screen.findAllByLabelText(/^grade$/i);
    const gradePointInputs = await screen.findAllByLabelText(/grade point/i);

    // Set the first band's values to cover 0–100
    await user.clear(minMarkInputs[0]!);
    await user.type(minMarkInputs[0]!, "0");
    await user.clear(maxMarkInputs[0]!);
    await user.type(maxMarkInputs[0]!, "100");
    await user.clear(gradeInputs[0]!);
    await user.type(gradeInputs[0]!, "A");
    await user.clear(gradePointInputs[0]!);
    await user.type(gradePointInputs[0]!, "4");

    // Save
    const saveBtn = await screen.findByRole("button", { name: /^save$/i });
    await user.click(saveBtn);

    await waitFor(() =>
      expect(createGradeScale).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "My Scale",
          bands: expect.any(Array),
        }),
      ),
    );
  });

  it("disables Save while bands have a gap", async () => {
    const { user } = renderScreen(<ConfigurationScreen />, {
      permissions: ["config.read", "config.manage", "institution.manage"],
      core: {
        getInstitution: async () =>
          ({ id: "i1", name: "Test Uni", calendarType: "SEMESTER" }) as never,
        listGradeScales: async () => [],
      },
    });

    await openGradingTab(user);
    await user.click(await screen.findByRole("button", { name: /new scale/i }));

    // Add two bands with a gap: 0-49 and 51-100
    const minMarkInputs = await screen.findAllByLabelText(/min mark/i);
    const maxMarkInputs = await screen.findAllByLabelText(/max mark/i);
    const gradeInputs = await screen.findAllByLabelText(/^grade$/i);

    // Set first band to 0-49 with grade F
    await user.clear(minMarkInputs[0]!);
    await user.type(minMarkInputs[0]!, "0");
    await user.clear(maxMarkInputs[0]!);
    await user.type(maxMarkInputs[0]!, "49");
    await user.clear(gradeInputs[0]!);
    await user.type(gradeInputs[0]!, "F");

    // Add a second band
    await user.click(screen.getByRole("button", { name: /add band/i }));

    const minMarkInputs2 = await screen.findAllByLabelText(/min mark/i);
    const maxMarkInputs2 = await screen.findAllByLabelText(/max mark/i);
    const gradeInputs2 = await screen.findAllByLabelText(/^grade$/i);

    // Set second band to 51-100 (gap at 50)
    await user.clear(minMarkInputs2[1]!);
    await user.type(minMarkInputs2[1]!, "51");
    await user.clear(maxMarkInputs2[1]!);
    await user.type(maxMarkInputs2[1]!, "100");
    await user.clear(gradeInputs2[1]!);
    await user.type(gradeInputs2[1]!, "A");

    // Save should be disabled and an error message visible
    await waitFor(() => {
      const saveBtn = screen.getByRole("button", { name: /^save$/i });
      expect(saveBtn).toBeDisabled();
    });
    // An error about gap should be visible
    expect(await screen.findByText(/gap/i)).toBeInTheDocument();
  });

  it("disables Delete for the default scale", async () => {
    const defaultScale = makeScale({
      id: "gs-default",
      name: "Default Scale",
      isDefault: true,
    });
    const { user } = renderScreen(<ConfigurationScreen />, {
      permissions: ["config.read", "config.manage", "institution.manage"],
      core: {
        getInstitution: async () =>
          ({ id: "i1", name: "Test Uni", calendarType: "SEMESTER" }) as never,
        listGradeScales: async () => [defaultScale],
      },
    });

    await openGradingTab(user);

    // Wait for the scale to be listed
    await screen.findByText("Default Scale");

    // The Delete button for the default scale should be disabled
    await waitFor(() => {
      const deleteBtn = screen.getByRole("button", {
        name: /delete "Default Scale"/i,
      });
      expect(deleteBtn).toBeDisabled();
    });
  });

  it("hides New/Edit/Delete without config.manage", async () => {
    const scale = makeScale({ id: "gs-1", name: "Read-only Scale" });
    const { user } = renderScreen(<ConfigurationScreen />, {
      permissions: ["config.read", "institution.manage"],
      core: {
        getInstitution: async () =>
          ({ id: "i1", name: "Test Uni", calendarType: "SEMESTER" }) as never,
        listGradeScales: async () => [scale],
      },
    });

    await openGradingTab(user);
    await screen.findByText("Read-only Scale");

    // New scale button should not be present
    expect(screen.queryByRole("button", { name: /new scale/i })).toBeNull();
    // Edit and Delete should also not be present
    expect(screen.queryByRole("button", { name: /^edit/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^delete/i })).toBeNull();
  });
});

/** Build a minimal StoredAssessmentConfig with JSON-serialised components. */
function makeConfig(
  overrides: Partial<StoredAssessmentConfig> = {},
): StoredAssessmentConfig {
  return {
    id: "ac-1",
    name: "Standard",
    components: JSON.stringify([
      { key: "ca", label: "Continuous Assessment", weight: 30, maxScore: 30 },
      { key: "exam", label: "Exam", weight: 70, maxScore: 100 },
    ]),
    isDefault: false,
    ...overrides,
  };
}

describe("AssessmentEditorModal", () => {
  it("creates an assessment config; Save gated on weights=100", async () => {
    const createAssessmentConfig = vi.fn(async () =>
      makeConfig({ id: "ac-new", name: "My Structure" }),
    );
    const { user } = renderScreen(<ConfigurationScreen />, {
      permissions: ["config.read", "config.manage"],
      core: {
        listAssessmentConfigs: async () => [],
        createAssessmentConfig,
      },
    });

    await openGradingTab(user);

    // Open the New structure modal
    await user.click(
      await screen.findByRole("button", { name: /new structure/i }),
    );

    // Fill in the name
    const nameInput = await screen.findByLabelText(/structure name/i);
    await user.clear(nameInput);
    await user.type(nameInput, "My Structure");

    // The modal starts with one blank row; clear it and set ca (weight 30, maxScore 30)
    const keyInputs = await screen.findAllByLabelText(/^key$/i);
    const weightInputs = await screen.findAllByLabelText(/^weight$/i);
    const maxScoreInputs = await screen.findAllByLabelText(/^max score$/i);

    await user.clear(keyInputs[0]!);
    await user.type(keyInputs[0]!, "ca");
    await user.clear(weightInputs[0]!);
    await user.type(weightInputs[0]!, "30");
    await user.clear(maxScoreInputs[0]!);
    await user.type(maxScoreInputs[0]!, "30");

    // Add a second component: exam (weight 70, maxScore 70)
    await user.click(screen.getByRole("button", { name: /add component/i }));

    const keyInputs2 = await screen.findAllByLabelText(/^key$/i);
    const weightInputs2 = await screen.findAllByLabelText(/^weight$/i);
    const maxScoreInputs2 = await screen.findAllByLabelText(/^max score$/i);

    await user.clear(keyInputs2[1]!);
    await user.type(keyInputs2[1]!, "exam");
    await user.clear(weightInputs2[1]!);
    await user.type(weightInputs2[1]!, "70");
    await user.clear(maxScoreInputs2[1]!);
    await user.type(maxScoreInputs2[1]!, "70");

    // Save should be enabled (weights = 100)
    const saveBtn = await screen.findByRole("button", { name: /^save$/i });
    await waitFor(() => expect(saveBtn).not.toBeDisabled());

    await user.click(saveBtn);

    await waitFor(() =>
      expect(createAssessmentConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "My Structure",
          components: expect.any(Array),
        }),
      ),
    );
  });

  it("shows running weight total and blocks Save at !=100", async () => {
    const { user } = renderScreen(<ConfigurationScreen />, {
      permissions: ["config.read", "config.manage"],
      core: {
        listAssessmentConfigs: async () => [],
      },
    });

    await openGradingTab(user);
    await user.click(
      await screen.findByRole("button", { name: /new structure/i }),
    );

    // Set one row with weight 90 (total != 100)
    const keyInputs = await screen.findAllByLabelText(/^key$/i);
    const weightInputs = await screen.findAllByLabelText(/^weight$/i);
    const maxScoreInputs = await screen.findAllByLabelText(/^max score$/i);

    await user.clear(keyInputs[0]!);
    await user.type(keyInputs[0]!, "ca");
    await user.clear(weightInputs[0]!);
    await user.type(weightInputs[0]!, "90");
    await user.clear(maxScoreInputs[0]!);
    await user.type(maxScoreInputs[0]!, "100");

    // The weight total indicator (aria-label="Total weight") should show 90
    const totalOutput = await screen.findByLabelText(/total weight/i);
    expect(totalOutput).toBeInTheDocument();
    await waitFor(() => {
      expect(totalOutput.textContent).toMatch(/90/);
    });

    // Save should be disabled
    await waitFor(() => {
      const saveBtn = screen.getByRole("button", { name: /^save$/i });
      expect(saveBtn).toBeDisabled();
    });
  }, 10000);
});
