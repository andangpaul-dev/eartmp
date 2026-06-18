// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { ResultsScreen } from "../../src/presentation/screens/ResultsScreen";
import type { Student } from "../../src/domain/entities";
import { renderScreen, pickStudent } from "./harness";

const student = {
  id: "s1",
  matricNumber: "CS/0001",
  fullName: "Ada Lovelace",
  status: "ACTIVE",
  programmeId: "prog1",
} as Student;

const baseCore = {
  listStudents: async () => ({ items: [student], total: 1 }),
  listSessions: async () => [{ id: "sess1", name: "2024/25" }] as never,
  listSemesters: async () => [{ id: "sem1", name: "First Semester" }] as never,
};

async function selectTarget(
  user: ReturnType<typeof import("@testing-library/user-event").default.setup>,
): Promise<void> {
  await pickStudent(user, "ada", /Ada Lovelace/);
  await user.selectOptions(await screen.findByLabelText("Session"), "sess1");
  await waitFor(() =>
    expect(screen.getByLabelText("Semester")).not.toBeDisabled(),
  );
  await user.selectOptions(screen.getByLabelText("Semester"), "sem1");
}

describe("ResultsScreen", () => {
  it("shows the empty state for a student/semester with no results", async () => {
    const { user } = renderScreen(<ResultsScreen />, {
      permissions: ["results.process"],
      core: { ...baseCore, getStudentSemesterResults: async () => [] },
    });
    await selectTarget(user);
    expect(await screen.findByText(/no results entered/i)).toBeInTheDocument();
  });

  it("shows each course's allocated credit value and the credit total", async () => {
    const { user } = renderScreen(<ResultsScreen />, {
      permissions: ["results.process"],
      core: {
        ...baseCore,
        getStudentSemesterResults: async () =>
          [
            {
              id: "r1",
              courseId: "c1",
              finalScore: 72,
              grade: "B",
              isLocked: false,
            },
            {
              id: "r2",
              courseId: "c2",
              finalScore: 65,
              grade: "C",
              isLocked: false,
            },
          ] as never,
        listCourses: async () =>
          ({
            items: [
              {
                id: "c1",
                code: "CS101",
                title: "Intro",
                creditValue: 3,
                courseType: "CORE",
              },
              {
                id: "c2",
                code: "MTH101",
                title: "Calculus",
                creditValue: 4,
                courseType: "CORE",
              },
            ],
            total: 2,
          }) as never,
      },
    });
    await selectTarget(user);

    expect(await screen.findByText("CS101")).toBeInTheDocument();
    expect(screen.getByText("MTH101")).toBeInTheDocument();
    // 3 + 4 credits allocated → total 7.
    expect(screen.getByText("Total credits")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("processes then locks the semester in one finalize action", async () => {
    const processSemester = vi.fn(async () => ({ gpa: 4.0 }) as never);
    const lockSemesterResults = vi.fn(async () => 1);
    const { user } = renderScreen(<ResultsScreen />, {
      permissions: ["results.process"],
      core: {
        ...baseCore,
        getStudentSemesterResults: async () =>
          [
            {
              id: "r1",
              courseId: "course-1",
              finalScore: 93,
              grade: "A",
              isLocked: false,
            },
          ] as never,
        processSemester,
        lockSemesterResults,
      },
    });
    await selectTarget(user);

    await user.click(
      await screen.findByRole("button", { name: /process semester/i }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /process/i }));

    await waitFor(() => {
      expect(processSemester).toHaveBeenCalledWith({
        studentId: "s1",
        semesterId: "sem1",
      });
      expect(lockSemesterResults).toHaveBeenCalledWith({
        studentId: "s1",
        semesterId: "sem1",
      });
    });
  });
});
