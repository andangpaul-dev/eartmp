// @vitest-environment jsdom
/**
 * Tests for the CourseRosterGrid batch entry component.
 * Drives the cascade selectors, score/status entry, DID mode,
 * resit mode, and faculty-scope filtering.
 */
import { screen, waitFor } from "@testing-library/react";
import { CourseRosterGrid } from "../../src/presentation/screens/CourseRosterGrid";
import type { Student } from "../../src/domain/entities";
import { renderScreen } from "./harness";

// ── shared fixtures ──────────────────────────────────────────────────────────

const SESSION = { id: "sess1", name: "2024/25", facultyIds: [] as string[] };
const SEMESTER = { id: "sem1", name: "First Semester" };
const FACULTY = { id: "fac1", code: "SCI", name: "Science" };
const DEPARTMENT = { id: "dept1", code: "CS", name: "Computer Science" };
const PROGRAMME = { id: "prog1", code: "BSC", name: "B.Sc. CS" };
const COURSE = {
  id: "crs1",
  code: "CS201",
  title: "Data Structures",
  creditValue: 3,
  courseType: "CORE",
};

const COMPONENTS = [
  { key: "CA", label: "CA", maxScore: 40 },
  { key: "EXAM", label: "Exam", maxScore: 60 },
];

const ROSTER: Student[] = [
  {
    id: "s1",
    matricNumber: "CS/001",
    fullName: "Alice Turing",
    status: "ACTIVE",
    programmeId: "prog1",
  } as Student,
  {
    id: "s2",
    matricNumber: "CS/002",
    fullName: "Bob Church",
    status: "ACTIVE",
    programmeId: "prog1",
  } as Student,
];

const BASE_CORE = {
  listSessions: async () => [SESSION] as never,
  listSemesters: async () => [SEMESTER] as never,
  listFaculties: async () => [FACULTY] as never,
  listDepartments: async () => [DEPARTMENT] as never,
  listProgrammes: async () => [PROGRAMME] as never,
  listCourses: async () => ({ items: [COURSE], total: 1 }) as never,
  getAssessmentStructure: async () => COMPONENTS as never,
  listCourseRoster: async () => ROSTER as never,
  saveCourseResults: vi.fn(async () => ({ saved: 2, skipped: 0, errors: [] })),
};

const PERMISSIONS = ["results.read", "results.process"];

// ── helper: drive the cascade down to Course ────────────────────────────────

async function cascadeToRoster(
  user: ReturnType<typeof import("@testing-library/user-event").default.setup>,
): Promise<void> {
  // Wait for sessions to load and option to appear before selecting
  await waitFor(() =>
    expect(
      screen.getByLabelText("Session").querySelector('option[value="sess1"]'),
    ).toBeInTheDocument(),
  );
  await user.selectOptions(screen.getByLabelText("Session"), "sess1");

  await waitFor(() =>
    expect(screen.getByLabelText("Semester")).not.toBeDisabled(),
  );
  await waitFor(() =>
    expect(
      screen.getByLabelText("Semester").querySelector('option[value="sem1"]'),
    ).toBeInTheDocument(),
  );
  await user.selectOptions(screen.getByLabelText("Semester"), "sem1");

  await waitFor(() =>
    expect(screen.getByLabelText("Faculty")).not.toBeDisabled(),
  );
  await waitFor(() =>
    expect(
      screen.getByLabelText("Faculty").querySelector('option[value="fac1"]'),
    ).toBeInTheDocument(),
  );
  await user.selectOptions(screen.getByLabelText("Faculty"), "fac1");

  await waitFor(() =>
    expect(screen.getByLabelText("Department")).not.toBeDisabled(),
  );
  await waitFor(() =>
    expect(
      screen
        .getByLabelText("Department")
        .querySelector('option[value="dept1"]'),
    ).toBeInTheDocument(),
  );
  await user.selectOptions(screen.getByLabelText("Department"), "dept1");

  await waitFor(() =>
    expect(screen.getByLabelText("Programme")).not.toBeDisabled(),
  );
  await waitFor(() =>
    expect(
      screen.getByLabelText("Programme").querySelector('option[value="prog1"]'),
    ).toBeInTheDocument(),
  );
  await user.selectOptions(screen.getByLabelText("Programme"), "prog1");

  await waitFor(() =>
    expect(screen.getByLabelText("Course")).not.toBeDisabled(),
  );
  await waitFor(() =>
    expect(
      screen.getByLabelText("Course").querySelector('option[value="crs1"]'),
    ).toBeInTheDocument(),
  );
  await user.selectOptions(screen.getByLabelText("Course"), "crs1");
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("CourseRosterGrid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cascades selectors and loads the roster", async () => {
    const listCourseRoster = vi.fn(async () => ROSTER as never);
    const { user } = renderScreen(<CourseRosterGrid />, {
      permissions: PERMISSIONS,
      core: { ...BASE_CORE, listCourseRoster },
    });

    await cascadeToRoster(user);

    await waitFor(() => {
      expect(listCourseRoster).toHaveBeenCalledWith(
        expect.objectContaining({ courseId: "crs1", sessionName: "2024/25" }),
      );
    });

    // Both students appear in the grid
    expect(await screen.findByText("Alice Turing")).toBeInTheDocument();
    expect(screen.getByText("Bob Church")).toBeInTheDocument();
  });

  it("Save all calls saveCourseResults with entered rows", async () => {
    const saveCourseResults = vi.fn(async () => ({
      saved: 2,
      skipped: 0,
      errors: [],
    }));
    const { user } = renderScreen(<CourseRosterGrid />, {
      permissions: PERMISSIONS,
      core: { ...BASE_CORE, saveCourseResults },
    });

    await cascadeToRoster(user);

    // Type a score for Alice in the CA component
    const caInput = await screen.findByLabelText("CA score for s1");
    await user.clear(caInput);
    await user.type(caInput, "35");

    await user.click(screen.getByRole("button", { name: /save all/i }));

    await waitFor(() => {
      expect(saveCourseResults).toHaveBeenCalledWith(
        expect.objectContaining({
          courseId: "crs1",
          sitting: "NORMAL",
          rows: expect.arrayContaining([
            expect.objectContaining({ studentId: "s1" }),
          ]),
        }),
      );
    });
  });

  it("marking a student DID disables their score cells", async () => {
    const saveCourseResults = vi.fn(async () => ({
      saved: 2,
      skipped: 0,
      errors: [],
    }));
    const { user } = renderScreen(<CourseRosterGrid />, {
      permissions: PERMISSIONS,
      core: { ...BASE_CORE, saveCourseResults },
    });

    await cascadeToRoster(user);

    // Set status for s1 to DID
    const statusSelect = await screen.findByLabelText("Status for s1");
    await user.selectOptions(statusSelect, "DID");

    // Score inputs for s1 should be disabled
    expect(screen.getByLabelText("CA score for s1")).toBeDisabled();
    expect(screen.getByLabelText("Exam score for s1")).toBeDisabled();

    // Score inputs for s2 should still be enabled
    expect(screen.getByLabelText("CA score for s2")).not.toBeDisabled();

    // Save and verify the row carries DID status
    await user.click(screen.getByRole("button", { name: /save all/i }));

    await waitFor(() => {
      expect(saveCourseResults).toHaveBeenCalledWith(
        expect.objectContaining({
          rows: expect.arrayContaining([
            expect.objectContaining({ studentId: "s1", status: "DID" }),
          ]),
        }),
      );
    });
  });

  it("resit mode — saveCourseResults called with sitting RESIT", async () => {
    const saveCourseResults = vi.fn(async () => ({
      saved: 2,
      skipped: 0,
      errors: [],
    }));
    const { user } = renderScreen(<CourseRosterGrid />, {
      permissions: PERMISSIONS,
      core: { ...BASE_CORE, saveCourseResults },
    });

    await cascadeToRoster(user);

    // Switch sitting to RESIT
    await user.selectOptions(screen.getByLabelText("Sitting"), "RESIT");

    await user.click(screen.getByRole("button", { name: /save all/i }));

    await waitFor(() => {
      expect(saveCourseResults).toHaveBeenCalledWith(
        expect.objectContaining({ sitting: "RESIT" }),
      );
    });
  });

  it("(faculty scope) a scoped officer sees only assigned faculties", async () => {
    const scopedSession = {
      userId: "u-scoped",
      role: "FACULTY_OFFICER",
      permissions: PERMISSIONS,
      facultyIds: ["f1"],
    };
    const facF1 = { id: "f1", code: "ENG", name: "Engineering" };
    const facF2 = { id: "f2", code: "SCI", name: "Science" };

    const { user } = renderScreen(<CourseRosterGrid />, {
      permissions: PERMISSIONS,
      core: {
        ...BASE_CORE,
        currentUser: async () => scopedSession as never,
        listFaculties: async () => [facF1, facF2] as never,
      },
    });

    await waitFor(() =>
      expect(
        screen.getByLabelText("Session").querySelector('option[value="sess1"]'),
      ).toBeInTheDocument(),
    );
    await user.selectOptions(screen.getByLabelText("Session"), "sess1");

    await waitFor(() =>
      expect(screen.getByLabelText("Faculty")).not.toBeDisabled(),
    );

    const facultySelect = screen.getByLabelText("Faculty");
    // Only f1 (Engineering) should be an option; f2 (Science) should not
    expect(facultySelect).toContainElement(
      screen.getByRole("option", { name: /Engineering/i }),
    );
    expect(
      facultySelect.querySelector('option[value="f2"]'),
    ).not.toBeInTheDocument();
  });
});
