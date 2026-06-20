import { describe, it, expect } from "vitest";
import { ProcessSemester } from "../../src/application/use-cases/results/ProcessSemester";
import { GradingConfigService } from "../../src/application/services/GradingConfigService";
import { buildDefaultRegistry } from "../../src/domain/settings/SettingsRegistry";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import {
  FakeGradeScaleRepo,
  FakeAssessmentConfigRepo,
} from "../config/grading-fakes";
import { InMemorySettingRepository } from "../config/fakes";
import type { Course } from "../../src/domain/entities";
import type { CourseRepository } from "../../src/domain/repositories/records";
import { FakeResultRepo, fakeUow } from "./fakes";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "results.process",
]);

const simpleBands = JSON.stringify([
  { minMark: 0, maxMark: 49, grade: "F", gradePoint: 0, isPass: false },
  { minMark: 50, maxMark: 100, grade: "P", gradePoint: 4, isPass: true },
]);

async function makeGrading() {
  const scales = new FakeGradeScaleRepo();
  const created = await scales.create({
    name: "Default",
    bands: simpleBands,
    isDefault: true,
  });
  const grading = new GradingConfigService(
    scales,
    new FakeAssessmentConfigRepo(),
    new InMemorySettingRepository(),
    buildDefaultRegistry(),
  );
  return { grading, scaleId: created.id };
}

const courses = {
  async findById(id: string): Promise<Course | null> {
    const table: Record<string, Course> = {
      c1: {
        id: "c1",
        code: "CS101",
        title: "I",
        creditValue: 3,
        courseType: "CORE",
      },
      c2: {
        id: "c2",
        code: "MA101",
        title: "C",
        creditValue: 2,
        courseType: "CORE",
      },
    };
    return table[id] ?? null;
  },
} as unknown as CourseRepository;

function seededResults() {
  const results = new FakeResultRepo();
  results.rows.push(
    {
      id: "r1",
      studentId: "s1",
      courseId: "c1",
      semesterId: "sem1",
      componentScores: [],
      finalScore: 80,
      isLocked: false,
      sitting: "NORMAL" as const,
      status: "GRADED" as const,
    },
    {
      id: "r2",
      studentId: "s1",
      courseId: "c2",
      semesterId: "sem1",
      componentScores: [],
      finalScore: 30,
      isLocked: false,
      sitting: "NORMAL" as const,
      status: "GRADED" as const,
    },
  );
  return results;
}

describe("ProcessSemester", () => {
  it("processes atomically, computes GPA, and stamps grade-scale provenance", async () => {
    const { grading, scaleId } = await makeGrading();
    const results = seededResults();
    const uow = fakeUow({ results, courses });

    const summary = await new ProcessSemester(uow, grading).execute(
      { studentId: "s1", semesterId: "sem1" },
      admin,
    );

    // c1 P(4)*3=12, c2 F(0)*2=0 => 12/5 = 2.4
    expect(summary.gpa).toBe(2.4);
    expect(results.rows.find((r) => r.id === "r1")!.grade).toBe("P");
    // provenance (F-19) recorded on each processed result
    expect(results.provenance["r1"]).toBe(scaleId);
    expect(results.provenance["r2"]).toBe(scaleId);
  });

  it("uses the student's per-level grade scale when set (Feature 2)", async () => {
    // Default scale: 50+ passes. A lenient per-level scale: 30+ passes at 4.0.
    const scales = new FakeGradeScaleRepo();
    await scales.create({
      name: "Default",
      bands: simpleBands,
      isDefault: true,
    });
    const lenient = await scales.create({
      name: "Lenient-100",
      bands: JSON.stringify([
        { minMark: 0, maxMark: 29, grade: "F", gradePoint: 0, isPass: false },
        { minMark: 30, maxMark: 100, grade: "P", gradePoint: 4, isPass: true },
      ]),
      isDefault: false,
    });
    const grading = new GradingConfigService(
      scales,
      new FakeAssessmentConfigRepo(),
      new InMemorySettingRepository(),
      buildDefaultRegistry(),
    );
    const results = seededResults();
    const uow = fakeUow({ results, courses });

    const students = {
      async findById(id: string) {
        return id === "s1" ? { id: "s1", levelId: "L1" } : null;
      },
    } as unknown as import("../../src/domain/repositories/records").StudentRepository;
    const levels = {
      async findById(id: string) {
        return id === "L1"
          ? {
              id: "L1",
              name: "100",
              rank: 1,
              programmeId: "p1",
              gradeScaleId: lenient.id,
            }
          : null;
      },
    } as unknown as import("../../src/domain/repositories/structure").LevelRepository;

    const summary = await new ProcessSemester(
      uow,
      grading,
      students,
      levels,
    ).execute({ studentId: "s1", semesterId: "sem1" }, admin);

    // Under the lenient level scale both courses pass at 4.0 → (4*3 + 4*2)/5 = 4.0
    expect(summary.gpa).toBe(4);
    expect(results.rows.find((r) => r.id === "r2")!.grade).toBe("P");
    // Provenance is the per-level scale, not the default.
    expect(results.provenance["r1"]).toBe(lenient.id);
  });

  it("an explicit override beats the per-level scale", async () => {
    const scales = new FakeGradeScaleRepo();
    const def = await scales.create({
      name: "Default",
      bands: simpleBands,
      isDefault: true,
    });
    const lenient = await scales.create({
      name: "Lenient",
      bands: JSON.stringify([
        { minMark: 0, maxMark: 100, grade: "P", gradePoint: 4, isPass: true },
      ]),
      isDefault: false,
    });
    const grading = new GradingConfigService(
      scales,
      new FakeAssessmentConfigRepo(),
      new InMemorySettingRepository(),
      buildDefaultRegistry(),
    );
    const results = seededResults();
    const uow = fakeUow({ results, courses });
    const students = {
      async findById() {
        return { id: "s1", levelId: "L1" };
      },
    } as unknown as import("../../src/domain/repositories/records").StudentRepository;
    const levels = {
      async findById() {
        return {
          id: "L1",
          name: "100",
          rank: 1,
          programmeId: "p1",
          gradeScaleId: lenient.id,
        };
      },
    } as unknown as import("../../src/domain/repositories/structure").LevelRepository;

    await new ProcessSemester(uow, grading, students, levels).execute(
      { studentId: "s1", semesterId: "sem1", gradeScaleRef: { id: def.id } },
      admin,
    );
    // The explicit default override wins over the level's lenient scale.
    expect(results.provenance["r1"]).toBe(def.id);
  });

  it("does not mutate a locked row; recomputes only unlocked ones", async () => {
    const { grading } = await makeGrading();
    const results = new FakeResultRepo();
    // Same course c1 (credit 3): NORMAL locked, RESIT unlocked
    results.rows.push(
      {
        id: "rNormalLocked",
        studentId: "s1",
        courseId: "c1",
        semesterId: "sem1",
        componentScores: [],
        finalScore: 40,
        isLocked: true,
        sitting: "NORMAL" as const,
        status: "GRADED" as const,
      },
      {
        id: "rResitUnlocked",
        studentId: "s1",
        courseId: "c1",
        semesterId: "sem1",
        componentScores: [],
        finalScore: 60,
        isLocked: false,
        sitting: "RESIT" as const,
        status: "GRADED" as const,
      },
    );
    const uow = fakeUow({ results, courses });
    // Should NOT throw — locked rows are silently skipped for writes
    const summary = await new ProcessSemester(uow, grading).execute(
      { studentId: "s1", semesterId: "sem1" },
      admin,
    );
    // Locked NORMAL must NOT have been written
    expect(results.provenance["rNormalLocked"]).toBeUndefined();
    // Unlocked RESIT must have been written
    expect(results.provenance["rResitUnlocked"]).toBeDefined();
    // Effective is RESIT (60 → P at 4): GPA = 4*3/3 = 4
    expect(summary.gpa).toBe(4);
  });

  it("stamps both sittings but counts only the resit in GPA", async () => {
    const { grading } = await makeGrading();
    const results = new FakeResultRepo();
    // NORMAL sitting: DID (no score, counts as fail=0); semesterId sem1
    results.rows.push({
      id: "rNormal",
      studentId: "s1",
      courseId: "c1",
      semesterId: "sem1",
      componentScores: [],
      finalScore: undefined,
      isLocked: false,
      sitting: "NORMAL" as const,
      status: "DID" as const,
    });
    // RESIT sitting: GRADED, finalScore=70; same semesterId sem1
    results.rows.push({
      id: "rResit",
      studentId: "s1",
      courseId: "c1",
      semesterId: "sem1",
      componentScores: [],
      finalScore: 70,
      isLocked: false,
      sitting: "RESIT" as const,
      status: "GRADED" as const,
    });
    // semesterOrdering: give RESIT a higher sitting rank so it is "latest" for same course
    const uow = fakeUow({ results, courses });
    const summary = await new ProcessSemester(uow, grading).execute(
      { studentId: "s1", semesterId: "sem1" },
      admin,
    );
    // Both rows stamped
    expect(results.provenance["rNormal"]).toBeDefined();
    expect(results.provenance["rResit"]).toBeDefined();
    // Course c1 (credit 3) counted once: resit is effective (RESIT > NORMAL in sitting order)
    expect(summary.creditsAttempted).toBe(3);
    // 70 → "P"(4) on the simple scale, so GPA = 4*3/3 = 4
    expect(summary.gpa).toBe(4);
  });

  it("excludes an INCOMPLETE course from GPA", async () => {
    const { grading } = await makeGrading();
    const results = new FakeResultRepo();
    results.rows.push({
      id: "rInc",
      studentId: "s1",
      courseId: "c1",
      semesterId: "sem1",
      componentScores: [],
      finalScore: undefined,
      isLocked: false,
      sitting: "NORMAL" as const,
      status: "INCOMPLETE" as const,
    });
    const uow = fakeUow({ results, courses });
    const summary = await new ProcessSemester(uow, grading).execute(
      { studentId: "s1", semesterId: "sem1" },
      admin,
    );
    // INCOMPLETE is pending — not stamped, not counted
    expect(results.provenance["rInc"]).toBeUndefined();
    expect(summary.creditsAttempted).toBe(0);
    expect(summary.gpa).toBe(0);
  });
});
