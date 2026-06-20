// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { StudentsScreen } from "../../src/presentation/screens/StudentsScreen";
import type { Student } from "../../src/domain/entities";
import type {
  Faculty,
  Department,
  Programme,
  Level,
} from "../../src/presentation/runtime/contract";
import type { AcademicSession } from "../../src/domain/entities/structure";
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

  it("previews the matricule when faculty + admission session are set", async () => {
    const faculties: Faculty[] = [{ id: "f1", name: "Science", code: "SCI" }];
    const sessions: AcademicSession[] = [
      { id: "sess1", name: "2024/2025", isCurrent: false },
    ];
    const previewMatricule = vi.fn(async () => ({
      matricule: "SCI/2024/0001",
    }));
    const { user } = renderScreen(<StudentsScreen />, {
      permissions: ["students.read", "students.create"],
      core: {
        listFaculties: async () => faculties,
        listSessions: async () => sessions,
        previewMatricule,
      },
    });
    await user.click(
      await screen.findByRole("button", { name: /admit student/i }),
    );
    const dialog = await screen.findByRole("dialog");

    await user.selectOptions(within(dialog).getByLabelText("Faculty"), "f1");
    await user.selectOptions(
      within(dialog).getByLabelText("Admission session"),
      "2024/2025",
    );

    await waitFor(() =>
      expect(previewMatricule).toHaveBeenCalledWith(
        expect.objectContaining({
          facultyId: "f1",
          admissionSession: "2024/2025",
        }),
      ),
    );
    await within(dialog).findByText("SCI/2024/0001");
  });

  it("auto mode omits matricNumber when admitting", async () => {
    const faculties: Faculty[] = [{ id: "f1", name: "Science", code: "SCI" }];
    const sessions: AcademicSession[] = [
      { id: "sess1", name: "2024/2025", isCurrent: false },
    ];
    const departments: Department[] = [
      { id: "d1", name: "Computer Science", code: "CS", facultyId: "f1" },
    ];
    const programmes: Programme[] = [
      {
        id: "p1",
        name: "B.Sc CS",
        code: "BSCS",
        departmentId: "d1",
        durationLevels: 4,
        creditsRequired: 120,
      },
    ];
    const levels: Level[] = [
      { id: "lv1", name: "Level 100", rank: 1, programmeId: "p1" },
    ];
    const issuedStudent = student({ matricNumber: "SCI/2024/AUTO" });
    const admitStudent = vi.fn(async () => ({ student: issuedStudent }));
    const { user } = renderScreen(<StudentsScreen />, {
      permissions: ["students.read", "students.create"],
      core: {
        listFaculties: async () => faculties,
        listDepartments: async () => departments,
        listProgrammes: async () => programmes,
        listLevels: async () => levels,
        listSessions: async () => sessions,
        admitStudent,
      },
    });

    await user.click(
      await screen.findByRole("button", { name: /admit student/i }),
    );
    const dialog = await screen.findByRole("dialog");

    await user.selectOptions(within(dialog).getByLabelText("Faculty"), "f1");
    await user.selectOptions(within(dialog).getByLabelText("Department"), "d1");
    await user.selectOptions(within(dialog).getByLabelText("Programme"), "p1");
    await user.selectOptions(within(dialog).getByLabelText("Level"), "lv1");
    await user.selectOptions(
      within(dialog).getByLabelText("Admission session"),
      "2024/2025",
    );
    await user.type(within(dialog).getByLabelText("Full name"), "Test Student");
    await user.click(within(dialog).getByRole("button", { name: /^admit$/i }));

    await waitFor(() =>
      expect(admitStudent).toHaveBeenCalledWith(
        expect.not.objectContaining({ matricNumber: expect.anything() }),
      ),
    );
    // issued matricule shown on success
    await within(dialog).findByText("SCI/2024/AUTO");
  });

  it("manual override sends the typed matricule", async () => {
    const faculties: Faculty[] = [{ id: "f1", name: "Science", code: "SCI" }];
    const sessions: AcademicSession[] = [
      { id: "sess1", name: "2024/2025", isCurrent: false },
    ];
    const departments: Department[] = [
      { id: "d1", name: "Computer Science", code: "CS", facultyId: "f1" },
    ];
    const programmes: Programme[] = [
      {
        id: "p1",
        name: "B.Sc CS",
        code: "BSCS",
        departmentId: "d1",
        durationLevels: 4,
        creditsRequired: 120,
      },
    ];
    const levels: Level[] = [
      { id: "lv1", name: "Level 100", rank: 1, programmeId: "p1" },
    ];
    const issuedStudent = student({ matricNumber: "CS/MANUAL/001" });
    const admitStudent = vi.fn(async () => ({ student: issuedStudent }));
    const { user } = renderScreen(<StudentsScreen />, {
      permissions: ["students.read", "students.create"],
      core: {
        listFaculties: async () => faculties,
        listDepartments: async () => departments,
        listProgrammes: async () => programmes,
        listLevels: async () => levels,
        listSessions: async () => sessions,
        admitStudent,
      },
    });

    await user.click(
      await screen.findByRole("button", { name: /admit student/i }),
    );
    const dialog = await screen.findByRole("dialog");

    // toggle manual override
    await user.click(within(dialog).getByLabelText(/enter manually/i));
    const matricInput = within(dialog).getByLabelText(/^matricule$/i);
    await user.type(matricInput, "CS/MANUAL/001");

    await user.selectOptions(within(dialog).getByLabelText("Faculty"), "f1");
    await user.selectOptions(within(dialog).getByLabelText("Department"), "d1");
    await user.selectOptions(within(dialog).getByLabelText("Programme"), "p1");
    await user.selectOptions(within(dialog).getByLabelText("Level"), "lv1");
    await user.selectOptions(
      within(dialog).getByLabelText("Admission session"),
      "2024/2025",
    );
    await user.type(
      within(dialog).getByLabelText("Full name"),
      "Test Student 2",
    );
    await user.click(within(dialog).getByRole("button", { name: /^admit$/i }));

    await waitFor(() =>
      expect(admitStudent).toHaveBeenCalledWith(
        expect.objectContaining({ matricNumber: "CS/MANUAL/001" }),
      ),
    );
  });

  it("readmit a withdrawn student", async () => {
    const withdrawn = student({
      id: "s2",
      status: "WITHDRAWN",
      fullName: "Old Student",
    });
    const departments: Department[] = [
      { id: "d1", name: "CS Dept", code: "CS", facultyId: "f1" },
    ];
    const programmes: Programme[] = [
      {
        id: "p1",
        name: "B.Sc CS",
        code: "BSCS",
        departmentId: "d1",
        durationLevels: 4,
        creditsRequired: 120,
      },
    ];
    const levels: Level[] = [
      { id: "lv1", name: "Level 100", rank: 1, programmeId: "p1" },
    ];
    const sessions: AcademicSession[] = [
      { id: "sess1", name: "2025/2026", isCurrent: false },
    ];
    const readmitStudent = vi.fn(async () => withdrawn);
    const { user } = renderScreen(<StudentsScreen />, {
      permissions: ["students.read", "students.update"],
      core: {
        listStudents: async () => ({ items: [withdrawn], total: 1 }),
        listDepartments: async () => departments,
        listProgrammes: async () => programmes,
        listLevels: async () => levels,
        listSessions: async () => sessions,
        readmitStudent,
      },
    });

    await user.click(await screen.findByText("Old Student"));
    await user.click(await screen.findByRole("button", { name: /^readmit$/i }));

    // profile modal closes, readmit modal opens
    const readmitDialog = await screen.findByRole("dialog", {
      name: /readmit student/i,
    });
    await user.selectOptions(
      within(readmitDialog).getByLabelText("Programme"),
      "p1",
    );
    await user.selectOptions(
      within(readmitDialog).getByLabelText("Level"),
      "lv1",
    );
    await user.selectOptions(
      within(readmitDialog).getByLabelText(/from session/i),
      "2025/2026",
    );
    await user.click(
      within(readmitDialog).getByRole("button", { name: /^save$/i }),
    );

    await waitFor(() =>
      expect(readmitStudent).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId: "s2",
          programmeId: "p1",
          levelId: "lv1",
          fromSession: "2025/2026",
        }),
      ),
    );
  });

  it("regenerate matricule with confirmation", async () => {
    const s = student({ id: "s3" });
    const regenerateMatricule = vi.fn(async () => ({ matricule: "NEW/001" }));
    const { user } = renderScreen(<StudentsScreen />, {
      permissions: ["students.read", "students.update"],
      core: {
        listStudents: async () => ({ items: [s], total: 1 }),
        regenerateMatricule,
      },
    });

    await user.click(await screen.findByText("Ada Lovelace"));
    await user.click(
      await screen.findByRole("button", { name: /regenerate matricule/i }),
    );

    // confirm dialog should appear
    const confirmDialog1 = await screen.findByRole("dialog", {
      name: /regenerate matricule/i,
    });
    expect(confirmDialog1).toBeInTheDocument();
    // Cancel — should NOT call
    await user.click(
      within(confirmDialog1).getByRole("button", { name: /cancel/i }),
    );
    expect(regenerateMatricule).not.toHaveBeenCalled();

    // now confirm
    await user.click(
      await screen.findByRole("button", { name: /regenerate matricule/i }),
    );
    const confirmDialog2 = await screen.findByRole("dialog", {
      name: /regenerate matricule/i,
    });
    await user.click(
      within(confirmDialog2).getByRole("button", { name: /confirm/i }),
    );

    await waitFor(() =>
      expect(regenerateMatricule).toHaveBeenCalledWith({ studentId: "s3" }),
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
