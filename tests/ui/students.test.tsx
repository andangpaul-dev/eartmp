// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { StudentsScreen } from "../../src/presentation/screens/StudentsScreen";
import type { Student } from "../../src/domain/entities";
import type { Faculty } from "../../src/presentation/runtime/contract";
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

  it("groups by faculty — selecting one queries listStudents with facultyId", async () => {
    const faculties: Faculty[] = [{ id: "f1", name: "Science", code: "SCI" }];
    const listStudents = vi.fn(async () => ({ items: [], total: 0 }));
    const { user } = renderScreen(<StudentsScreen />, {
      permissions: ["students.read"],
      core: { listStudents, listFaculties: async () => faculties },
    });
    await screen.findByRole("option", { name: "Science" });
    await user.selectOptions(screen.getByLabelText(/filter by faculty/i), "f1");
    await waitFor(() =>
      expect(listStudents).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ facultyId: "f1" }),
        }),
      ),
    );
  });

  it("edits full admission details via updateStudent", async () => {
    const updateStudent = vi.fn(async () => student());
    const { user } = renderScreen(<StudentsScreen />, {
      permissions: ["students.read", "students.update"],
      core: {
        listStudents: async () => ({ items: [student()], total: 1 }),
        updateStudent,
      },
    });
    await user.click(await screen.findByText("Ada Lovelace"));
    await user.click(
      await screen.findByRole("button", { name: /edit details/i }),
    );
    const name = await screen.findByDisplayValue("Ada Lovelace");
    await user.clear(name);
    await user.type(name, "Ada L. Byron");
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() =>
      expect(updateStudent).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "s1",
          patch: expect.objectContaining({ fullName: "Ada L. Byron" }),
        }),
      ),
    );
  });
});
