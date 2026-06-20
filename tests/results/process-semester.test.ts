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

  it("refuses to process a locked semester (AD9.3)", async () => {
    const { grading } = await makeGrading();
    const results = seededResults();
    results.rows[0]!.isLocked = true;
    const uow = fakeUow({ results, courses });
    await expect(
      new ProcessSemester(uow, grading).execute(
        { studentId: "s1", semesterId: "sem1" },
        admin,
      ),
    ).rejects.toThrow(/locked/);
  });
});
