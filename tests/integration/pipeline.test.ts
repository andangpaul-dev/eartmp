/**
 * End-to-end pipeline integration (Phase 20) — composes the REAL use-cases over
 * in-memory fakes, proving the phases interoperate across boundaries with no DB
 * and no UI: admit → enter results → process semester → academic summary →
 * evaluate graduation → graduate.
 */
import { describe, it, expect } from "vitest";
import { AdmitStudent } from "../../src/application/use-cases/records/AdmitStudent";
import { EnterResult } from "../../src/application/use-cases/results/ManageResults";
import { ProcessSemester } from "../../src/application/use-cases/results/ProcessSemester";
import { GetAcademicSummary } from "../../src/application/use-cases/results/GetAcademicSummary";
import {
  EvaluateGraduation,
  GraduateStudent,
} from "../../src/application/use-cases/graduation/Graduation";
import { GradingConfigService } from "../../src/application/services/GradingConfigService";
import { GraduationConfigService } from "../../src/application/services/GraduationConfigService";
import { buildDefaultRegistry } from "../../src/domain/settings/SettingsRegistry";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import {
  FakeStudentRepo,
  FakeCourseRepo,
  FakeEnrollmentRepo,
} from "../records/fakes";
import {
  FakeGradeScaleRepo,
  FakeAssessmentConfigRepo,
} from "../config/grading-fakes";
import { InMemorySettingRepository } from "../config/fakes";
import { FakeResultRepo, fakeUow } from "../results/fakes";
import { CapturingAudit } from "../auth/fakes";

const FIVE_POINT = [
  { minMark: 70, maxMark: 100, grade: "A", gradePoint: 4, isPass: true },
  { minMark: 60, maxMark: 69, grade: "B", gradePoint: 3, isPass: true },
  { minMark: 50, maxMark: 59, grade: "C", gradePoint: 2, isPass: true },
  { minMark: 45, maxMark: 49, grade: "D", gradePoint: 1, isPass: true },
  { minMark: 0, maxMark: 44, grade: "F", gradePoint: 0, isPass: false },
];
const CA_EXAM = [
  { key: "ca", label: "CA", weight: 30, maxScore: 30 },
  { key: "exam", label: "Exam", weight: 70, maxScore: 70 },
];

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "students.create",
  "results.process",
  "results.read",
  "graduation.read",
  "graduation.clear",
]);

describe("Pipeline integration (admit → … → graduate)", () => {
  it("runs the whole records-to-graduation flow over fakes", async () => {
    // --- shared fakes (one source of truth per repo) ---
    const students = new FakeStudentRepo();
    const enrollments = new FakeEnrollmentRepo();
    const courses = new FakeCourseRepo();
    const results = new FakeResultRepo();
    const audit = new CapturingAudit();
    const uow = fakeUow({ students, enrollments, courses, results, audit });

    const scales = new FakeGradeScaleRepo();
    await scales.create({
      name: "5-Point",
      bands: JSON.stringify(FIVE_POINT),
      isDefault: true,
    });
    const assess = new FakeAssessmentConfigRepo();
    await assess.create({
      name: "CA+Exam",
      components: JSON.stringify(CA_EXAM),
      isDefault: true,
    });
    const registry = buildDefaultRegistry();
    const settings = new InMemorySettingRepository();
    const grading = new GradingConfigService(
      scales,
      assess,
      settings,
      registry,
    );
    const gradConfig = new GraduationConfigService(settings, registry);

    // --- Phase 6/7: admit (atomic student + enrollment) ---
    const admitted = await new AdmitStudent(uow).execute(
      {
        matricNumber: "E2E/0001",
        fullName: "Ada Lovelace",
        programmeId: "p1",
        levelId: "l1",
        fromSession: "2024/2025",
      },
      admin,
    );
    expect(admitted.student.matricNumber).toBe("E2E/0001");
    const studentId = admitted.student.id;
    expect(admitted.enrollment.studentId).toBe(studentId);

    // --- Phase 6: courses ---
    const cs = await courses.create({
      code: "CS101",
      title: "Intro",
      creditValue: 3,
      courseType: "CORE",
    });
    const ma = await courses.create({
      code: "MA101",
      title: "Calc",
      creditValue: 2,
      courseType: "CORE",
    });

    // --- Phase 9: enter results (final score computed via assessment structure) ---
    const enter = new EnterResult(results, grading, audit);
    const r1 = await enter.execute(
      {
        studentId,
        courseId: cs.id,
        semesterId: "sem1",
        componentScores: [
          { key: "ca", score: 28 },
          { key: "exam", score: 65 },
        ],
      },
      admin,
    );
    await enter.execute(
      {
        studentId,
        courseId: ma.id,
        semesterId: "sem1",
        componentScores: [
          { key: "ca", score: 27 },
          { key: "exam", score: 63 },
        ],
      },
      admin,
    );
    expect(r1.finalScore).toBe(93);

    // --- Phase 9: process the semester (atomic, GPA + provenance) ---
    const summary = await new ProcessSemester(uow, grading).execute(
      { studentId, semesterId: "sem1" },
      admin,
    );
    expect(summary.gpa).toBe(4); // (4*3 + 4*2) / 5

    // --- Phase 11: academic summary (CGPA + standing) ---
    const academic = new GetAcademicSummary(results, courses, grading);
    const report = await academic.execute({ studentId }, admin);
    expect(report.cgpa).toBe(4);
    expect(report.creditsEarned).toBe(5);
    expect(report.standing).toBe("First Class");

    // --- Phase 16: evaluate + clear graduation ---
    const eligibility = await new EvaluateGraduation(
      academic,
      gradConfig,
    ).execute({ studentId }, admin);
    expect(eligibility.eligible).toBe(true);

    const cleared = await new GraduateStudent(
      academic,
      gradConfig,
      students,
      audit,
    ).execute({ studentId }, admin);
    expect(cleared.status).toBe("GRADUATED");
    expect((await students.findById(studentId))?.status).toBe("GRADUATED");

    // the trail recorded admit, results, processing, and the graduation
    expect(audit.entries.some((e) => e.action === "GRADUATE")).toBe(true);
  });
});
