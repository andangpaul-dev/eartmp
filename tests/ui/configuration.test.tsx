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
});
