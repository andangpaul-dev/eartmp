// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { ConfigurationScreen } from "../../src/presentation/screens/ConfigurationScreen";
import type { Institution } from "../../src/presentation/runtime/contract";
import { renderScreen } from "./harness";

const institution = (): Institution =>
  ({
    id: "inst-1",
    name: "Example University",
    calendarType: "SEMESTER",
  }) as Institution;

describe("ConfigurationScreen", () => {
  it("loads the institution profile on the default tab", async () => {
    renderScreen(<ConfigurationScreen />, {
      permissions: ["settings.read", "institution.manage"],
      core: { getInstitution: async () => institution() },
    });
    expect(
      await screen.findByDisplayValue("Example University"),
    ).toBeInTheDocument();
  });

  it("switches to the Grading tab and lists grade scales", async () => {
    const listGradeScales = vi.fn(async () => []);
    const { user } = renderScreen(<ConfigurationScreen />, {
      permissions: ["settings.read", "config.read", "institution.manage"],
      core: { getInstitution: async () => institution(), listGradeScales },
    });

    await screen.findByDisplayValue("Example University");
    await user.click(screen.getByRole("tab", { name: /grading/i }));

    expect(await screen.findByText("Grade scales")).toBeInTheDocument();
    await waitFor(() => expect(listGradeScales).toHaveBeenCalled());
  });

  it("saves an edited institution field through updateInstitution", async () => {
    const updateInstitution = vi.fn(async () => institution());
    const { user } = renderScreen(<ConfigurationScreen />, {
      permissions: ["settings.read", "institution.manage"],
      core: { getInstitution: async () => institution(), updateInstitution },
    });

    const name = await screen.findByDisplayValue("Example University");
    await user.clear(name);
    await user.type(name, "Renamed University");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(updateInstitution).toHaveBeenCalledWith({
        patch: expect.objectContaining({ name: "Renamed University" }),
      }),
    );
  });

  it("edits the matricule template settings", async () => {
    const getSetting = vi.fn(async (input: { key: string }) => {
      if (input.key === "student.matriculeRule")
        return "{faculty}{year2}-{seq:0000}";
      if (input.key === "student.matriculeCheckScheme") return "none";
      if (input.key === "student.matriculeFormat") return "upper";
      return null;
    });
    const setSetting = vi.fn(async () => {});
    const { user } = renderScreen(<ConfigurationScreen />, {
      permissions: ["settings.read", "settings.manage", "institution.manage"],
      core: {
        getInstitution: async () => institution(),
        getSetting,
        setSetting,
      },
    });

    // Navigate to the Matricule tab
    await screen.findByDisplayValue("Example University");
    await user.click(screen.getByRole("tab", { name: /matricule/i }));

    // The rule field should be loaded
    const ruleInput = await screen.findByDisplayValue(
      "{faculty}{year2}-{seq:0000}",
    );
    await user.clear(ruleInput);
    // userEvent treats { as key-descriptor start; escape with {{
    await user.type(ruleInput, "{{faculty}{{year2}-{{seq:0000}");

    await user.click(
      screen.getByRole("button", { name: /save matricule settings/i }),
    );

    await waitFor(() =>
      expect(setSetting).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "student.matriculeRule",
          value: "{faculty}{year2}-{seq:0000}",
        }),
      ),
    );

    // check-scheme select
    const schemeSelect = screen.getByLabelText(/check scheme/i);
    expect(schemeSelect).toBeInTheDocument();

    // live sample uses expandMatricule: contains "SCI" + ends with "-0001"
    const liveSampleEl = screen.getByLabelText(/live sample/i);
    expect(liveSampleEl).toBeInTheDocument();
    expect(liveSampleEl.textContent).toMatch(/SCI\d{2}-0001/);
  });
});
