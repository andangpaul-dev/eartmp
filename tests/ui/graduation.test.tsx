// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { GraduationScreen } from "../../src/presentation/screens/GraduationScreen";
import type { Student } from "../../src/domain/entities";
import type { EligibilityReport } from "../../src/presentation/runtime/contract";
import { renderScreen, pickStudent } from "./harness";

const student = (over: Partial<Student> = {}): Student =>
  ({
    id: "s1",
    matricNumber: "CS/0001",
    fullName: "Ada Lovelace",
    status: "ACTIVE",
    ...over,
  }) as Student;

const studentList = { items: [student()], total: 1 };

const report = (eligible: boolean): EligibilityReport => ({
  eligible,
  criteria: [
    { name: "Minimum CGPA", required: 1.0, actual: 4.0, met: true },
    {
      name: "Minimum credits earned",
      required: 120,
      actual: eligible ? 120 : 90,
      met: eligible,
    },
  ],
});

describe("GraduationScreen", () => {
  it("shows transparent criteria and blocks an ineligible student", async () => {
    const { user } = renderScreen(<GraduationScreen />, {
      permissions: ["graduation.read", "graduation.clear"],
      core: {
        listStudents: async () => studentList,
        evaluateGraduation: async () => report(false),
      },
    });
    await pickStudent(user, "ada", /Ada Lovelace/);

    expect(await screen.findByText("Minimum CGPA")).toBeInTheDocument();
    expect(screen.getByText(/not yet eligible/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /clear for graduation/i }),
    ).toBeDisabled();
  });

  it("clears an eligible student through graduateStudent", async () => {
    const graduateStudent = vi.fn(async () => ({
      status: "GRADUATED",
      report: report(true),
    }));
    const { user } = renderScreen(<GraduationScreen />, {
      permissions: ["graduation.read", "graduation.clear"],
      core: {
        listStudents: async () => studentList,
        evaluateGraduation: async () => report(true),
        graduateStudent,
      },
    });
    await pickStudent(user, "ada", /Ada Lovelace/);

    await user.click(
      await screen.findByRole("button", { name: /clear for graduation/i }),
    );
    // Confirm dialog → irreversible action.
    await user.click(
      await screen.findByRole("button", { name: /graduate student/i }),
    );
    await waitFor(() =>
      expect(graduateStudent).toHaveBeenCalledWith({ studentId: "s1" }),
    );
  });
});
