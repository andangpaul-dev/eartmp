// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { StudentsScreen } from "../../src/presentation/screens/StudentsScreen";
import type { Student } from "../../src/domain/entities";
import { renderScreen } from "./harness";

const student = (over: Partial<Student> = {}): Student =>
  ({
    id: "s1",
    matricNumber: "CS/0001",
    fullName: "Ada Lovelace",
    status: "ACTIVE",
    admissionSession: "24/25",
    ...over,
  }) as Student;

describe("StudentsScreen", () => {
  it("shows the empty state when there are no students", async () => {
    renderScreen(<StudentsScreen />, { permissions: ["students.read"] });
    expect(await screen.findByText(/no students/i)).toBeInTheDocument();
  });

  it("renders a student row with its status badge", async () => {
    renderScreen(<StudentsScreen />, {
      permissions: ["students.read"],
      core: {
        listStudents: async () => ({ items: [student()], total: 1 }),
      },
    });
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("CS/0001")).toBeInTheDocument();
    // The status also appears as a filter <option>; assert the row badge.
    expect(
      screen.getByText("ACTIVE", { selector: "span.badge" }),
    ).toBeInTheDocument();
  });

  it("hides the Admit action without students.create", async () => {
    renderScreen(<StudentsScreen />, { permissions: ["students.read"] });
    await screen.findByText(/no students/i);
    expect(
      screen.queryByRole("button", { name: /admit student/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the Admit action with students.create", async () => {
    renderScreen(<StudentsScreen />, {
      permissions: ["students.read", "students.create"],
    });
    expect(
      await screen.findByRole("button", { name: /admit student/i }),
    ).toBeInTheDocument();
  });
});
