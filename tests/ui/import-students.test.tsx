// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { ImportStudentsScreen } from "../../src/presentation/screens/ImportStudentsScreen";
import type {
  Faculty,
  Department,
} from "../../src/presentation/runtime/contract";
import { renderScreen } from "./harness";

const faculties: Faculty[] = [{ id: "f1", name: "Science", code: "SCI" }];
const departments: Department[] = [
  { id: "d1", name: "Computer Science", code: "CS", facultyId: "f1" },
];

describe("ImportStudentsScreen", () => {
  it("validates parsed rows against the chosen placement (dry run)", async () => {
    const importStudents = vi.fn(async () => ({
      totalRows: 2,
      validRows: 2,
      imported: 0,
      errors: [],
    }));
    const { user } = renderScreen(<ImportStudentsScreen />, {
      permissions: ["students.create", "structure.read"],
      core: {
        listFaculties: async () => faculties,
        listDepartments: async () => departments,
        parseWorkbook: async () => [
          { matricNumber: "M/1", fullName: "Ada" },
          { matricNumber: "M/2", fullName: "Bo" },
        ],
        importStudents,
      },
    });

    await screen.findByRole("option", { name: "Science" });
    await user.selectOptions(screen.getByLabelText("Faculty"), "f1");
    await screen.findByRole("option", { name: "Computer Science" });
    await user.selectOptions(screen.getByLabelText("Department"), "d1");

    // Simulate a parsed file by firing the hidden file input.
    const file = new File(["x"], "students.csv", { type: "text/csv" });
    const input = screen.getByLabelText("Spreadsheet file");
    await user.upload(input, file);

    const validateBtn = await screen.findByRole("button", {
      name: /validate/i,
    });
    await waitFor(() => expect(validateBtn).toBeEnabled());
    await user.click(validateBtn);

    await waitFor(() =>
      expect(importStudents).toHaveBeenCalledWith(
        expect.objectContaining({
          facultyId: "f1",
          departmentId: "d1",
          dryRun: true,
        }),
      ),
    );
    expect(await screen.findByText(/2 valid/)).toBeInTheDocument();
  });
});
