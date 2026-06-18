// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { StructureScreen } from "../../src/presentation/screens/StructureScreen";
import type {
  Faculty,
  Department,
  Programme,
  Level,
  Course,
} from "../../src/presentation/runtime/contract";
import { renderScreen } from "./harness";

const perms = [
  "structure.read",
  "structure.manage",
  "courses.read",
  "courses.create",
  "courses.update",
];

const faculties: Faculty[] = [{ id: "f1", name: "Science", code: "SCI" }];
const departments: Department[] = [
  { id: "d1", name: "Computer Science", code: "CS", facultyId: "f1" },
];
const programmes: Programme[] = [
  {
    id: "p1",
    name: "BSc CS",
    code: "CSC",
    departmentId: "d1",
    durationLevels: 4,
    creditsRequired: 120,
  },
];
const levels: Level[] = [
  { id: "l1", name: "Level 1", rank: 1, programmeId: "p1" },
  { id: "l2", name: "Level 2", rank: 2, programmeId: "p1" },
];
const courses: Course[] = [
  {
    id: "c1",
    code: "CS101",
    title: "Intro to CS",
    creditValue: 3,
    courseType: "CORE",
    programmeId: "p1",
    levelId: "l1",
    semesterRank: 1,
  },
];

function baseCore(extra: Record<string, unknown> = {}) {
  return {
    listInstitutions: async () => [],
    listFaculties: async () => faculties,
    listDepartments: async () => departments,
    listProgrammes: async () => programmes,
    listLevels: async () => levels,
    listGradeScales: async () => [],
    listCourses: async () => ({ items: courses, total: courses.length }),
    ...extra,
  };
}

async function drillToProgramme(user: ReturnType<typeof renderScreen>["user"]) {
  await user.click(await screen.findByText("Science"));
  await user.click(await screen.findByText(/Computer Science/));
  await user.click(await screen.findByText(/BSc CS/));
}

describe("StructureScreen — curriculum", () => {
  it("shows the curriculum with courses organised under their year", async () => {
    const { user } = renderScreen(<StructureScreen />, {
      permissions: perms,
      core: baseCore(),
    });
    await drillToProgramme(user);

    expect(await screen.findByText(/Curriculum — BSc CS/)).toBeInTheDocument();
    // Years-of-training editor reflects the programme.
    expect(
      (screen.getByLabelText("Years of training") as HTMLInputElement).value,
    ).toBe("4");
    // Course appears under its level.
    expect(screen.getByText(/Level 1: Level 1/)).toBeInTheDocument();
    expect(screen.getByText("CS101")).toBeInTheDocument();
    // Credit accounting against the requirement (3 of 120 → short).
    expect(screen.getByText(/short of 120/)).toBeInTheDocument();
  });

  it("saves edited programme details (years of training) via updateProgramme", async () => {
    const updateProgramme = vi.fn(async () => programmes[0]!);
    const { user } = renderScreen(<StructureScreen />, {
      permissions: perms,
      core: baseCore({ updateProgramme }),
    });
    await drillToProgramme(user);

    const years = await screen.findByLabelText("Years of training");
    await user.clear(years);
    await user.type(years, "5");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));

    await waitFor(() =>
      expect(updateProgramme).toHaveBeenCalledWith({
        id: "p1",
        patch: {
          name: "BSc CS",
          code: "CSC",
          durationLevels: 5,
          creditsRequired: 120,
        },
      }),
    );
  });

  it("generates the missing levels for the years of training", async () => {
    const createLevel = vi.fn(async (i: { rank: number }) => ({
      id: `lx${i.rank}`,
      name: `Level ${i.rank}`,
      rank: i.rank,
      programmeId: "p1",
    }));
    const { user } = renderScreen(<StructureScreen />, {
      permissions: perms,
      core: baseCore({ createLevel }),
    });
    await drillToProgramme(user);

    // 4 years of training, levels 1 & 2 exist → 2 missing (ranks 3, 4).
    await user.click(
      await screen.findByRole("button", { name: /Generate 2 levels/ }),
    );
    await waitFor(() => expect(createLevel).toHaveBeenCalledTimes(2));
    expect(createLevel).toHaveBeenCalledWith({
      name: "Level 3",
      rank: 3,
      programmeId: "p1",
    });
    expect(createLevel).toHaveBeenCalledWith({
      name: "Level 4",
      rank: 4,
      programmeId: "p1",
    });
  });

  it("auto-generates Level 1..N when a new programme is created", async () => {
    const createProgramme = vi.fn(async () => ({
      id: "p9",
      name: "BSc Maths",
      code: "MTH",
      departmentId: "d1",
      durationLevels: 4,
      creditsRequired: 0,
    }));
    const createLevel = vi.fn(async (i: { rank: number }) => ({
      id: `l${i.rank}`,
      name: `Level ${i.rank}`,
      rank: i.rank,
      programmeId: "p9",
    }));
    const { user } = renderScreen(<StructureScreen />, {
      permissions: perms,
      core: baseCore({
        listProgrammes: async () => [],
        createProgramme,
        createLevel,
      }),
    });
    await user.click(await screen.findByText("Science"));
    await user.click(await screen.findByText(/Computer Science/));

    const panel = (await screen.findByText("Programmes")).closest(
      ".card",
    ) as HTMLElement;
    await user.type(within(panel).getByPlaceholderText("Code"), "MTH");
    await user.type(within(panel).getByPlaceholderText("Name"), "BSc Maths");
    await user.click(within(panel).getByRole("button"));

    await waitFor(() => expect(createProgramme).toHaveBeenCalled());
    await waitFor(() => expect(createLevel).toHaveBeenCalledTimes(4));
    expect(createLevel).toHaveBeenCalledWith({
      name: "Level 1",
      rank: 1,
      programmeId: "p9",
    });
    expect(createLevel).toHaveBeenCalledWith({
      name: "Level 4",
      rank: 4,
      programmeId: "p9",
    });
  });
});
