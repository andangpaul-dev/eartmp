// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { ImportCoursesScreen } from "../../src/presentation/screens/ImportCoursesScreen";
import type {
  Department,
  Programme,
  Level,
} from "../../src/presentation/runtime/contract";
import { renderScreen } from "./harness";

const departments: Department[] = [
  { id: "d1", name: "Sci", code: "SCI", facultyId: "f1" },
];
const programmes: Programme[] = [
  {
    id: "p1",
    name: "CS",
    code: "CS",
    departmentId: "d1",
    durationLevels: 3,
    creditsRequired: 120,
  },
];
const levels: Level[] = [{ id: "l1", name: "100", rank: 1, programmeId: "p1" }];

describe("ImportCoursesScreen", () => {
  it("validates then commits, calling importCourses with the scope", async () => {
    const importCourses = vi.fn(async () => ({
      totalRows: 1,
      validRows: 1,
      created: 1,
      updated: 0,
      errors: [],
    }));
    const { user } = renderScreen(<ImportCoursesScreen />, {
      permissions: ["courses.create", "structure.read"],
      core: {
        listFaculties: async () => [{ id: "f1", name: "Faculty", code: "F" }],
        listDepartments: async () => departments,
        listProgrammes: async () => programmes,
        listLevels: async () => levels,
        parseWorkbook: async () => [
          {
            "Course code": "C1",
            "Course title": "X",
            "Credit Value": 3,
            "Course type": "CORE",
          },
        ],
        importCourses,
      },
    });

    // Select faculty first (listDepartments requires facultyId)
    await screen.findByRole("option", { name: "Faculty" });
    await user.selectOptions(screen.getByLabelText("Faculty"), "f1");

    // Select department
    await screen.findByRole("option", { name: "Sci" });
    await user.selectOptions(screen.getByLabelText("Department"), "d1");

    // Select programme
    await screen.findByRole("option", { name: "CS" });
    await user.selectOptions(screen.getByLabelText("Programme"), "p1");

    // Select level
    await screen.findByRole("option", { name: "100" });
    await user.selectOptions(screen.getByLabelText("Level"), "l1");

    // Select semester
    await user.selectOptions(screen.getByLabelText("Semester"), "1");

    // Upload file
    const file = new File(["x"], "courses.csv", { type: "text/csv" });
    const input = screen.getByLabelText("Spreadsheet file");
    await user.upload(input, file);

    // Wait for rows parsed
    await screen.findByText(/rows parsed/i, undefined, { timeout: 5000 });

    // Click Validate
    const validateBtn = await screen.findByRole("button", {
      name: /validate/i,
    });
    await waitFor(() => expect(validateBtn).toBeEnabled(), { timeout: 5000 });
    await user.click(validateBtn);

    await waitFor(() =>
      expect(importCourses).toHaveBeenCalledWith(
        expect.objectContaining({
          programmeId: "p1",
          levelId: "l1",
          semesterRank: 1,
          dryRun: true,
        }),
      ),
    );

    // Click Commit
    const commitBtn = await screen.findByRole("button", { name: /commit/i });
    await user.click(commitBtn);

    await waitFor(() =>
      expect(importCourses).toHaveBeenCalledWith(
        expect.objectContaining({
          programmeId: "p1",
          levelId: "l1",
          semesterRank: 1,
        }),
      ),
    );

    // The commit call should NOT have dryRun: true
    const allCalls = importCourses.mock.calls as { dryRun?: boolean }[][];
    const commitCall = allCalls.find((c) => !c[0]?.dryRun);
    expect(commitCall).toBeDefined();
  });

  it("download template button present", async () => {
    const createObjectURL = vi.fn(() => "blob:test");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });

    renderScreen(<ImportCoursesScreen />, {
      permissions: ["courses.create"],
    });

    const btn = await screen.findByRole("button", {
      name: /download template/i,
    });
    expect(btn).toBeInTheDocument();
    // clicking it should not throw
    btn.click();

    vi.unstubAllGlobals();
  });
});
