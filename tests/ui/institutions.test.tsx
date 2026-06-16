// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { InstitutionsScreen } from "../../src/presentation/screens/InstitutionsScreen";
import type {
  Institution,
  Faculty,
} from "../../src/presentation/runtime/contract";
import { renderScreen } from "./harness";

const inst = (over: Partial<Institution> = {}): Institution =>
  ({
    id: "i1",
    name: "Alpha University",
    code: "AU",
    isDefault: true,
    calendarType: "SEMESTER",
    ...over,
  }) as Institution;

const manage = ["settings.read", "institution.manage", "structure.read"];

describe("InstitutionsScreen", () => {
  it("lists institutions with a default badge and their faculties", async () => {
    const faculties: Faculty[] = [
      { id: "f1", name: "Science", code: "SCI", institutionId: "i1" },
    ];
    renderScreen(<InstitutionsScreen />, {
      permissions: manage,
      core: {
        listInstitutions: async () => [inst()],
        listFaculties: async () => faculties,
      },
    });
    expect(await screen.findByText("Alpha University")).toBeInTheDocument();
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByText(/Science/)).toBeInTheDocument();
  });

  it("creates an institution", async () => {
    const createInstitution = vi.fn(async () => inst({ id: "i2" }));
    const { user } = renderScreen(<InstitutionsScreen />, {
      permissions: manage,
      core: {
        listInstitutions: async () => [],
        listFaculties: async () => [],
        createInstitution,
      },
    });
    await user.click(
      await screen.findByRole("button", { name: /new institution/i }),
    );
    await user.type(screen.getByLabelText("Name"), "Beta Institute");
    await user.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() =>
      expect(createInstitution).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Beta Institute" }),
      ),
    );
  });

  it("hides management without institution.manage", async () => {
    renderScreen(<InstitutionsScreen />, {
      permissions: ["settings.read"],
      core: {
        listInstitutions: async () => [inst()],
        listFaculties: async () => [],
      },
    });
    expect(await screen.findByText("Alpha University")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /new institution/i }),
    ).not.toBeInTheDocument();
  });
});
