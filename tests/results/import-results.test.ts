import { describe, it, expect, beforeEach } from "vitest";
import { ImportResults } from "../../src/application/use-cases/results/ImportResults";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { GradingConfigService } from "../../src/application/services/GradingConfigService";
import { buildDefaultRegistry } from "../../src/domain/settings/SettingsRegistry";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { FakeStudentRepo, FakeCourseRepo } from "../records/fakes";
import {
  FakeAssessmentConfigRepo,
  FakeGradeScaleRepo,
} from "../config/grading-fakes";
import { InMemorySettingRepository } from "../config/fakes";
import { FakeResultRepo, fakeUow } from "./fakes";

const admin = SessionContext.create("admin", "SUPER_ADMIN", ["results.import"]);
const SEM = "sem1";

async function setup() {
  const students = new FakeStudentRepo();
  await students.create({
    matricNumber: "M/1",
    fullName: "Ada",
    status: "ACTIVE",
  });
  await students.create({
    matricNumber: "M/2",
    fullName: "Bo",
    status: "ACTIVE",
  });
  const courses = new FakeCourseRepo();
  await courses.create({
    code: "CS101",
    title: "Intro",
    creditValue: 3,
    courseType: "CORE",
  });

  const assess = new FakeAssessmentConfigRepo();
  await assess.create({
    name: "Default",
    components: JSON.stringify([
      { key: "ca", label: "CA", weight: 30, maxScore: 30 },
      { key: "exam", label: "Exam", weight: 70, maxScore: 70 },
    ]),
    isDefault: true,
  });
  const grading = new GradingConfigService(
    new FakeGradeScaleRepo(),
    assess,
    new InMemorySettingRepository(),
    buildDefaultRegistry(),
  );

  const results = new FakeResultRepo();
  // Validation + commit now run inside the unit of work, so the tx repos must
  // include students/courses (the use-case reads everything through `repos`).
  const uow = fakeUow({ students, courses, results });
  const uc = new ImportResults(grading, uow);
  return { uc, results };
}

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  ctx = await setup();
});

describe("ImportResults", () => {
  it("imports a clean batch and computes final scores", async () => {
    const report = await ctx.uc.execute(
      {
        semesterId: SEM,
        rows: [
          { matricNumber: "M/1", courseCode: "CS101", ca: 28, exam: 65 },
          { matricNumber: "M/2", courseCode: "CS101", ca: 30, exam: 70 },
        ],
      },
      admin,
    );
    expect(report.imported).toBe(2);
    expect(report.errors).toHaveLength(0);
    expect(
      ctx.results.rows.find((r) => r.studentId === "st1")!.finalScore,
    ).toBe(93);
  });

  it("is all-or-nothing: any error means nothing is written", async () => {
    const report = await ctx.uc.execute(
      {
        semesterId: SEM,
        rows: [
          { matricNumber: "M/1", courseCode: "CS101", ca: 28, exam: 65 },
          { matricNumber: "M/9", courseCode: "CS101", ca: 10, exam: 10 }, // unknown student
        ],
      },
      admin,
    );
    expect(report.imported).toBe(0);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatchObject({ row: 2 });
    expect(ctx.results.rows).toHaveLength(0);
  });

  it("reports unknown course, out-of-range scores, and in-file duplicates", async () => {
    const report = await ctx.uc.execute(
      {
        semesterId: SEM,
        rows: [
          { matricNumber: "M/1", courseCode: "NOPE", ca: 1, exam: 1 },
          { matricNumber: "M/1", courseCode: "CS101", ca: 99, exam: 65 }, // ca > maxScore
          { matricNumber: "M/2", courseCode: "CS101", ca: 10, exam: 10 },
          { matricNumber: "M/2", courseCode: "CS101", ca: 11, exam: 11 }, // duplicate
        ],
      },
      admin,
    );
    expect(report.imported).toBe(0);
    expect(report.errors.map((e) => e.row).sort()).toEqual([1, 2, 4]);
    expect(report.errors.find((e) => e.row === 1)!.messages.join()).toMatch(
      /Unknown course/,
    );
    expect(report.errors.find((e) => e.row === 4)!.messages.join()).toMatch(
      /Duplicate/,
    );
  });

  it("dry run validates + reports without writing", async () => {
    const report = await ctx.uc.execute(
      {
        semesterId: SEM,
        rows: [{ matricNumber: "M/1", courseCode: "CS101", ca: 28, exam: 65 }],
        dryRun: true,
      },
      admin,
    );
    expect(report.validRows).toBe(1);
    expect(report.imported).toBe(0);
    expect(ctx.results.rows).toHaveLength(0);
  });

  it("rejects importing onto a locked result", async () => {
    await ctx.results.create({
      studentId: "st1",
      courseId: "co1",
      semesterId: SEM,
      componentScores: [],
      finalScore: 50,
      isLocked: true,
      sitting: "NORMAL",
      status: "GRADED",
    });
    const report = await ctx.uc.execute(
      {
        semesterId: SEM,
        rows: [{ matricNumber: "M/1", courseCode: "CS101", ca: 28, exam: 65 }],
      },
      admin,
    );
    expect(report.imported).toBe(0);
    expect(report.errors[0]!.messages.join()).toMatch(/locked/);
  });

  it("flags a missing component score", async () => {
    const report = await ctx.uc.execute(
      {
        semesterId: SEM,
        rows: [{ matricNumber: "M/1", courseCode: "CS101", ca: 28 }],
      },
      admin,
    );
    expect(report.imported).toBe(0);
    expect(report.errors[0]!.messages.join()).toMatch(/score for "exam"/);
  });

  it("updates an existing unlocked result instead of duplicating", async () => {
    await ctx.results.create({
      studentId: "st1",
      courseId: "co1",
      semesterId: SEM,
      componentScores: [],
      finalScore: 10,
      isLocked: false,
      sitting: "NORMAL",
      status: "GRADED",
    });
    const report = await ctx.uc.execute(
      {
        semesterId: SEM,
        rows: [{ matricNumber: "M/1", courseCode: "CS101", ca: 30, exam: 70 }],
      },
      admin,
    );
    expect(report.imported).toBe(1);
    expect(ctx.results.rows).toHaveLength(1); // updated, not duplicated
    expect(ctx.results.rows[0]!.finalScore).toBe(100);
  });

  it("does not overwrite an existing RESIT row when importing NORMAL", async () => {
    // Seed a RESIT row for st1/co1 — import must not touch it
    await ctx.results.create({
      studentId: "st1",
      courseId: "co1",
      semesterId: SEM,
      componentScores: [
        { key: "ca", score: 5 },
        { key: "exam", score: 10 },
      ],
      finalScore: 15,
      isLocked: false,
      sitting: "RESIT",
      status: "GRADED",
    });
    const report = await ctx.uc.execute(
      {
        semesterId: SEM,
        rows: [{ matricNumber: "M/1", courseCode: "CS101", ca: 30, exam: 70 }],
      },
      admin,
    );
    expect(report.imported).toBe(1);
    // Must have TWO rows: the original RESIT unchanged, plus a new NORMAL
    expect(ctx.results.rows).toHaveLength(2);
    const resitRow = ctx.results.rows.find((r) => r.sitting === "RESIT")!;
    expect(resitRow.finalScore).toBe(15); // untouched
    const normalRow = ctx.results.rows.find((r) => r.sitting === "NORMAL")!;
    expect(normalRow.finalScore).toBe(100);
  });

  it("is denied without results.import", async () => {
    const viewer = SessionContext.create("v", "VIEWER", ["results.read"]);
    await expect(
      authorize(ctx.uc, { semesterId: SEM, rows: [] }, viewer),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("accepts matric/code/'Course code' aliases", async () => {
    const report = await ctx.uc.execute(
      {
        semesterId: SEM,
        rows: [{ matric: "M/1", code: "CS101", ca: 28, exam: 65 }],
      },
      admin,
    );
    expect(report.imported).toBe(1);
    expect(report.errors).toHaveLength(0);
    expect(ctx.results.rows[0]!.finalScore).toBe(93);
  });

  it("imports a RESIT row as a separate row from the NORMAL one", async () => {
    await ctx.results.create({
      studentId: "st1",
      courseId: "co1",
      semesterId: SEM,
      componentScores: [],
      finalScore: 40,
      isLocked: false,
      sitting: "NORMAL",
      status: "GRADED",
    });
    const report = await ctx.uc.execute(
      {
        semesterId: SEM,
        rows: [
          {
            matricNumber: "M/1",
            courseCode: "CS101",
            ca: 30,
            exam: 70,
            sitting: "RESIT",
          },
        ],
      },
      admin,
    );
    expect(report.imported).toBe(1);
    expect(ctx.results.rows).toHaveLength(2);
    const normal = ctx.results.rows.find((r) => r.sitting === "NORMAL")!;
    expect(normal.finalScore).toBe(40);
    const resit = ctx.results.rows.find((r) => r.sitting === "RESIT")!;
    expect(resit.finalScore).toBe(100);
  });

  it("imports a DID row with no scores and stores no finalScore", async () => {
    const report = await ctx.uc.execute(
      {
        semesterId: SEM,
        rows: [{ matricNumber: "M/1", courseCode: "CS101", status: "DID" }],
      },
      admin,
    );
    expect(report.imported).toBe(1);
    expect(report.errors).toHaveLength(0);
    const row = ctx.results.rows[0]!;
    expect(row.status).toBe("DID");
    expect(row.finalScore).toBeUndefined();
  });

  it("re-imports a DID row as GRADED, updating the same row with a finalScore", async () => {
    await ctx.results.create({
      studentId: "st1",
      courseId: "co1",
      semesterId: SEM,
      componentScores: [],
      isLocked: false,
      sitting: "NORMAL",
      status: "DID",
    });
    const report = await ctx.uc.execute(
      {
        semesterId: SEM,
        rows: [{ matricNumber: "M/1", courseCode: "CS101", ca: 30, exam: 70 }],
      },
      admin,
    );
    expect(report.imported).toBe(1);
    expect(ctx.results.rows).toHaveLength(1); // updated in place
    const row = ctx.results.rows[0]!;
    expect(row.status).toBe("GRADED");
    expect(row.finalScore).toBe(100);
  });

  it("flags an unknown sitting or status value", async () => {
    const report = await ctx.uc.execute(
      {
        semesterId: SEM,
        rows: [
          {
            matricNumber: "M/1",
            courseCode: "CS101",
            ca: 1,
            exam: 1,
            sitting: "EXTRA",
          },
          {
            matricNumber: "M/2",
            courseCode: "CS101",
            ca: 1,
            exam: 1,
            status: "BOGUS",
          },
        ],
      },
      admin,
    );
    expect(report.imported).toBe(0);
    expect(report.errors.find((e) => e.row === 1)!.messages.join()).toMatch(
      /Unknown result sitting/,
    );
    expect(report.errors.find((e) => e.row === 2)!.messages.join()).toMatch(
      /Unknown result status/,
    );
  });

  it("a non-graded status update clears the finalScore on the existing row", async () => {
    await ctx.results.create({
      studentId: "st1",
      courseId: "co1",
      semesterId: SEM,
      componentScores: [{ key: "ca", score: 20 }],
      finalScore: 50,
      isLocked: false,
      sitting: "NORMAL",
      status: "GRADED",
    });
    const report = await ctx.uc.execute(
      {
        semesterId: SEM,
        rows: [
          { matricNumber: "M/1", courseCode: "CS101", status: "INCOMPLETE" },
        ],
      },
      admin,
    );
    expect(report.imported).toBe(1);
    expect(ctx.results.rows).toHaveLength(1);
    const row = ctx.results.rows[0]!;
    expect(row.status).toBe("INCOMPLETE");
    expect(row.finalScore == null).toBe(true);
  });
});
