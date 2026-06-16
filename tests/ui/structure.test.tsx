// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { StructureScreen } from "../../src/presentation/screens/StructureScreen";
import type {
  Faculty,
  Department,
} from "../../src/presentation/runtime/contract";
import { renderScreen } from "./harness";

const manage = ["structure.read", "structure.manage", "courses.read"];

describe("StructureScreen", () => {
  it("lists faculties and drills into departments on select", async () => {
    const faculties: Faculty[] = [{ id: "f1", name: "Science", code: "SCI" }];
    const departments: Department[] = [
      { id: "d1", name: "Computer Science", code: "CS", facultyId: "f1" },
    ];
    const { user } = renderScreen(<StructureScreen />, {
      permissions: manage,
      core: {
        listFaculties: async () => faculties,
        listDepartments: async () => departments,
      },
    });
    await user.click(await screen.findByText(/Science/));
    expect(await screen.findByText(/Computer Science/)).toBeInTheDocument();
  });

  it("creates a faculty via the add row", async () => {
    const createFaculty = vi.fn(async () => ({
      id: "f2",
      name: "Arts",
      code: "ART",
    }));
    const { user } = renderScreen(<StructureScreen />, {
      permissions: manage,
      core: { listFaculties: async () => [], createFaculty },
    });
    // The first panel's add row (Code + Name + add button).
    const codeInputs = await screen.findAllByPlaceholderText("Code");
    const nameInputs = screen.getAllByPlaceholderText("Name");
    await user.type(codeInputs[0]!, "ART");
    await user.type(nameInputs[0]!, "Arts");
    const addButtons = screen.getAllByRole("button");
    // Click the enabled add button in the Faculties panel (first one).
    await user.click(addButtons.find((b) => !b.hasAttribute("disabled"))!);
    await waitFor(() =>
      expect(createFaculty).toHaveBeenCalledWith({ name: "Arts", code: "ART" }),
    );
  });

  it("hides management controls without structure.manage", async () => {
    renderScreen(<StructureScreen />, {
      permissions: ["structure.read"],
      core: {
        listFaculties: async () => [{ id: "f1", name: "Science", code: "SCI" }],
      },
    });
    expect(await screen.findByText(/Science/)).toBeInTheDocument();
    // No add inputs are rendered when the user cannot manage.
    expect(screen.queryByPlaceholderText("Code")).not.toBeInTheDocument();
  });
});
