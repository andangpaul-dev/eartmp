import { describe, it, expect, vi } from "vitest";
import { ImportCourses } from "../../src/application/use-cases/records/ImportCourses";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import type { Course } from "../../src/domain/entities";

const admin = SessionContext.create("a", "SUPER_ADMIN", [
  "courses.create",
  "courses.update",
]);

function makeFakes() {
  const store = new Map<string, Course>();
  let seq = 0;
  const courses = {
    async findByCode(code: string) {
      return store.get(code.toLowerCase()) ?? null;
    },
    create: vi.fn(async (data: Omit<Course, "id">) => {
      const row: Course = { id: `c${++seq}`, ...data };
      store.set(String(data.code).toLowerCase(), row);
      return row;
    }),
    update: vi.fn(async (id: string, patch: Partial<Omit<Course, "id">>) => {
      const row = [...store.values()].find((c) => c.id === id)!;
      Object.assign(row, patch);
      return row;
    }),
  };
  const audit = { record: vi.fn(async () => {}) };
  const uow = {
    run: async <T>(
      work: (repos: {
        courses: typeof courses;
        audit: typeof audit;
      }) => Promise<T>,
    ) => work({ courses, audit }),
  };
  return { courses, audit, uow, store };
}

describe("ImportCourses", () => {
  it("creates new courses and reports created count", async () => {
    const { courses, uow } = makeFakes();
    const r = await new ImportCourses(uow as never).execute(
      {
        rows: [
          {
            "Course code": "PHY101",
            "Course title": "Physics I",
            "Credit Value": 3,
            "Course type": "Core",
          },
        ],
        programmeId: "p",
        levelId: "l",
        semesterRank: 1,
      },
      admin,
    );
    expect(r).toMatchObject({
      totalRows: 1,
      validRows: 1,
      created: 1,
      updated: 0,
      errors: [],
    });
    expect(courses.create).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "PHY101",
        title: "Physics I",
        creditValue: 3,
        courseType: "CORE",
        programmeId: "p",
        levelId: "l",
        semesterRank: 1,
      }),
    );
  });

  it("upserts an existing code (updates fields + re-places) and reports updated", async () => {
    const { courses, store, uow } = makeFakes();
    store.set("phy101", {
      id: "c0",
      code: "PHY101",
      title: "Old",
      creditValue: 2,
      courseType: "CORE",
    });
    const r = await new ImportCourses(uow as never).execute(
      {
        rows: [
          {
            code: "PHY101",
            title: "New",
            creditValue: 4,
            courseType: "ELECTIVE",
          },
        ],
        programmeId: "p2",
        levelId: "l2",
        semesterRank: 2,
      },
      admin,
    );
    expect(r).toMatchObject({ created: 0, updated: 1, errors: [] });
    expect(courses.update).toHaveBeenCalledWith(
      "c0",
      expect.objectContaining({
        title: "New",
        creditValue: 4,
        courseType: "ELECTIVE",
        programmeId: "p2",
        levelId: "l2",
        semesterRank: 2,
      }),
    );
  });

  it("flags in-file duplicate codes, invalid type, and non-positive credit", async () => {
    const { uow } = makeFakes();
    const r = await new ImportCourses(uow as never).execute(
      {
        rows: [
          { code: "C1", title: "A", creditValue: 3, courseType: "CORE" },
          { code: "C1", title: "B", creditValue: 3, courseType: "CORE" },
          { code: "C2", title: "C", creditValue: 0, courseType: "CORE" },
          { code: "C3", title: "D", creditValue: 3, courseType: "BOGUS" },
        ],
      },
      admin,
    );
    expect(r.errors.map((e) => e.row)).toEqual([2, 3, 4]);
    expect(r.created).toBe(0);
  });

  it("dry-run validates but writes nothing", async () => {
    const { courses, uow } = makeFakes();
    const r = await new ImportCourses(uow as never).execute(
      {
        rows: [{ code: "X1", title: "X", creditValue: 3, courseType: "CORE" }],
        dryRun: true,
      },
      admin,
    );
    expect(r.validRows).toBe(1);
    expect(r.created).toBe(0);
    expect(courses.create).not.toHaveBeenCalled();
  });
});
