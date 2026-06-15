// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { ImportScreen } from "../../src/presentation/screens/ImportScreen";
import type { ImportReport } from "../../src/presentation/runtime/contract";
import { renderScreen } from "./harness";

const baseCore = {
  listSessions: async () => [{ id: "sess1", name: "2024/25" }] as never,
  listSemesters: async () => [{ id: "sem1", name: "First Semester" }] as never,
};

const file = new File(["matric,course\nCS/1,CS101"], "results.csv", {
  type: "text/csv",
});

async function chooseTargetAndFile(
  user: ReturnType<typeof import("@testing-library/user-event").default.setup>,
): Promise<void> {
  await screen.findByLabelText("Session");
  // Options load async — wait for them before selecting.
  await screen.findByRole("option", { name: "2024/25" });
  await user.selectOptions(screen.getByLabelText("Session"), "sess1");
  await screen.findByRole("option", { name: "First Semester" });
  await user.selectOptions(screen.getByLabelText("Semester"), "sem1");
  await user.upload(screen.getByLabelText(/spreadsheet file/i), file);
}

describe("ImportScreen", () => {
  it("parses an uploaded workbook on the host and shows the row count", async () => {
    const parseWorkbook = vi.fn(async () => [
      { matricNumber: "CS/1", courseCode: "CS101", ca: 20, exam: 60 },
    ]);
    const { user } = renderScreen(<ImportScreen />, {
      permissions: ["results.import"],
      core: { ...baseCore, parseWorkbook },
    });
    await chooseTargetAndFile(user);

    await waitFor(() => expect(parseWorkbook).toHaveBeenCalled());
    expect(await screen.findByText(/1 rows parsed/i)).toBeInTheDocument();
  });

  it("dry-run validates and renders a scannable error report", async () => {
    const report: ImportReport = {
      totalRows: 2,
      validRows: 1,
      imported: 0,
      errors: [{ row: 2, messages: ["Unknown matric number"] }],
    } as ImportReport;
    const importResults = vi.fn(async () => report);
    const { user } = renderScreen(<ImportScreen />, {
      permissions: ["results.import"],
      core: {
        ...baseCore,
        parseWorkbook: async () => [
          { matricNumber: "CS/1", courseCode: "CS101", ca: 20, exam: 60 },
          { matricNumber: "CS/9", courseCode: "CS101", ca: 1, exam: 1 },
        ],
        importResults,
      },
    });
    await chooseTargetAndFile(user);
    await screen.findByText(/2 rows parsed/i);

    await user.click(screen.getByRole("button", { name: /^validate$/i }));

    await waitFor(() =>
      expect(importResults).toHaveBeenCalledWith(
        expect.objectContaining({ semesterId: "sem1", dryRun: true }),
      ),
    );
    expect(
      await screen.findByText(/unknown matric number/i),
    ).toBeInTheDocument();
  });
});
