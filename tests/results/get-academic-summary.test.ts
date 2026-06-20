import { describe, it, expect } from "vitest";
import { GetAcademicSummary } from "../../src/application/use-cases/results/GetAcademicSummary";
import { GradingConfigService } from "../../src/application/services/GradingConfigService";
import { buildDefaultRegistry } from "../../src/domain/settings/SettingsRegistry";
import { RecordsError } from "../../src/domain/errors/records";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { FakeCourseRepo } from "../records/fakes";
import {
  FakeGradeScaleRepo,
  FakeAssessmentConfigRepo,
} from "../config/grading-fakes";
import { InMemorySettingRepository } from "../config/fakes";
import type { ResultRecord } from "../../src/domain/entities";
import { FakeResultRepo } from "./fakes";

const admin = SessionContext.create("admin", "SUPER_ADMIN", ["results.read"]);

function grading() {
  return new GradingConfigService(
    new FakeGradeScaleRepo(),
    new FakeAssessmentConfigRepo(),
    new InMemorySettingRepository(),
    buildDefaultRegistry(),
  );
}

function processed(
  over: Partial<ResultRecord> &
    Pick<ResultRecord, "id" | "courseId" | "semesterId">,
): ResultRecord {
  return {
    studentId: "s1",
    componentScores: [],
    isLocked: true,
    gradePoint: 4,
    creditsEarned: 3,
    sitting: "NORMAL",
    status: "GRADED",
    ...over,
  };
}

describe("GetAcademicSummary", () => {
  it("aggregates per-semester GPA, CGPA (aggregate), and standing", async () => {
    const courses = new FakeCourseRepo();
    const c1 = await courses.create({
      code: "C1",
      title: "",
      creditValue: 3,
      courseType: "CORE",
    });
    const c2 = await courses.create({
      code: "C2",
      title: "",
      creditValue: 2,
      courseType: "CORE",
    });
    const c3 = await courses.create({
      code: "C3",
      title: "",
      creditValue: 3,
      courseType: "CORE",
    });
    const c4 = await courses.create({
      code: "C4",
      title: "",
      creditValue: 1,
      courseType: "CORE",
    });

    const results = new FakeResultRepo();
    results.rows.push(
      processed({
        id: "r1",
        courseId: c1.id,
        semesterId: "sem1",
        gradePoint: 4,
        creditsEarned: 3,
      }),
      processed({
        id: "r2",
        courseId: c2.id,
        semesterId: "sem1",
        gradePoint: 3,
        creditsEarned: 2,
      }),
      processed({
        id: "r3",
        courseId: c3.id,
        semesterId: "sem2",
        gradePoint: 2,
        creditsEarned: 3,
      }),
      processed({
        id: "r4",
        courseId: c4.id,
        semesterId: "sem2",
        gradePoint: 0,
        creditsEarned: 0,
      }),
      // unprocessed (no gradePoint) — must be excluded:
      {
        id: "r5",
        studentId: "s1",
        courseId: c1.id,
        semesterId: "sem3",
        componentScores: [],
        isLocked: false,
        sitting: "NORMAL" as const,
        status: "GRADED" as const,
      },
    );

    const s = await new GetAcademicSummary(results, courses, grading()).execute(
      { studentId: "s1" },
      admin,
    );

    expect(s.semesters).toHaveLength(2); // sem3 excluded (unprocessed)
    expect(s.semesters.find((x) => x.semesterId === "sem1")!.gpa).toBe(3.6);
    expect(s.semesters.find((x) => x.semesterId === "sem2")!.gpa).toBe(1.5);
    // aggregate: 24 quality / 9 credits = 2.67
    expect(s.cgpa).toBe(2.67);
    expect(s.creditsEarned).toBe(8);
    expect(s.standing).toBe("Second Class Lower");
  });

  it("throws when a processed result references a missing course", async () => {
    const results = new FakeResultRepo();
    results.rows.push(
      processed({ id: "r1", courseId: "ghost", semesterId: "sem1" }),
    );
    await expect(
      new GetAcademicSummary(results, new FakeCourseRepo(), grading()).execute(
        { studentId: "s1" },
        admin,
      ),
    ).rejects.toBeInstanceOf(RecordsError);
  });

  it("returns an empty summary (cgpa 0) for a student with no processed results", async () => {
    const s = await new GetAcademicSummary(
      new FakeResultRepo(),
      new FakeCourseRepo(),
      grading(),
    ).execute({ studentId: "s1" }, admin);
    expect(s.semesters).toHaveLength(0);
    expect(s.cgpa).toBe(0);
  });
});
