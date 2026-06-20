import { describe, it, expect } from "vitest";
import {
  BuildReportData,
  type TranscriptNameResolver,
} from "../../src/application/use-cases/transcripts/BuildReportData";
import { GradingConfigService } from "../../src/application/services/GradingConfigService";
import { buildDefaultRegistry } from "../../src/domain/settings/SettingsRegistry";
import { TranscriptError } from "../../src/domain/errors/transcript";
import { FakeStudentRepo, FakeCourseRepo } from "../records/fakes";
import {
  FakeGradeScaleRepo,
  FakeAssessmentConfigRepo,
} from "../config/grading-fakes";
import { InMemorySettingRepository } from "../config/fakes";
import { FakeResultRepo } from "../results/fakes";
import type { InstitutionRepository } from "../../src/domain/repositories/config";
import type { Institution } from "../../src/domain/entities/institution";
import type { SemesterOrdering } from "../../src/domain/repositories/records";

const institution: Institution = {
  id: "i1",
  name: "Example University",
  motto: "Knowledge",
  calendarType: "SEMESTER",
};
const institutions = {
  async get() {
    return institution;
  },
  async update() {
    return institution;
  },
} as unknown as InstitutionRepository;

const names: TranscriptNameResolver = {
  async programmeName(id) {
    return id ? "BSc CS" : undefined;
  },
  async departmentName(id) {
    return id ? "Computer Science" : undefined;
  },
  async facultyName(id) {
    return id ? "Science" : undefined;
  },
  async semesterName() {
    return "First Semester";
  },
  async sessionNameForSemester() {
    return "2024/2025";
  },
};

function grading() {
  return new GradingConfigService(
    new FakeGradeScaleRepo(),
    new FakeAssessmentConfigRepo(),
    new InMemorySettingRepository(),
    buildDefaultRegistry(),
  );
}

/** Fake SemesterOrdering that maps semesterId → { sessionOrder, rank }. */
function fakeSemesterOrdering(
  mapping: Record<string, { sessionOrder: number; rank: number }>,
): SemesterOrdering {
  return {
    async order(ids) {
      const out = new Map<string, { sessionOrder: number; rank: number }>();
      for (const id of ids) {
        const entry = mapping[id];
        if (entry) out.set(id, entry);
      }
      return out;
    },
  };
}

/** Single-semester ordering (all sems in session 0, rank 0). */
const trivialOrdering = fakeSemesterOrdering({
  sem1: { sessionOrder: 0, rank: 0 },
});

describe("BuildReportData", () => {
  it("assembles institution, student, sessions, summary, and verification", async () => {
    const students = new FakeStudentRepo();
    const student = await students.create({
      matricNumber: "M/1",
      fullName: "Ada",
      status: "ACTIVE",
      programmeId: "p1",
      departmentId: "d1",
      facultyId: "f1",
    });
    const courses = new FakeCourseRepo();
    const c1 = await courses.create({
      code: "CS101",
      title: "Intro",
      creditValue: 3,
      courseType: "CORE",
    });
    const results = new FakeResultRepo();
    results.rows.push({
      id: "r1",
      studentId: student.id,
      courseId: c1.id,
      semesterId: "sem1",
      componentScores: [],
      finalScore: 85,
      grade: "A",
      gradePoint: 4,
      creditsEarned: 3,
      isLocked: true,
      sitting: "NORMAL" as const,
      status: "GRADED" as const,
    });

    const builder = new BuildReportData(
      students,
      institutions,
      results,
      courses,
      names,
      grading(),
      trivialOrdering,
    );
    const data = await builder.assemble(
      student.id,
      "TR-7",
      "2026-01-01T00:00:00.000Z",
    );

    expect(data.institution).toMatchObject({
      name: "Example University",
      motto: "Knowledge",
    });
    expect(data.student).toMatchObject({
      fullName: "Ada",
      programme: "BSc CS",
      faculty: "Science",
    });
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0]).toMatchObject({
      session: "2024/2025",
      semester: "First Semester",
      semesterGpa: 4,
    });
    expect(data.sessions[0]!.courses[0]).toMatchObject({
      code: "CS101",
      grade: "A",
    });
    expect(data.summary).toMatchObject({ cgpa: 4, standing: "First Class" });
    expect(data.verification.transcriptNumber).toBe("TR-7");
  });

  it("throws when the student is missing", async () => {
    const builder = new BuildReportData(
      new FakeStudentRepo(),
      institutions,
      new FakeResultRepo(),
      new FakeCourseRepo(),
      names,
      grading(),
      trivialOrdering,
    );
    await expect(builder.assemble("ghost", "TR-1", "x")).rejects.toBeInstanceOf(
      TranscriptError,
    );
  });

  it("shows both attempts; resit grade flagged afterReattempt; legend added", async () => {
    const students = new FakeStudentRepo();
    const student = await students.create({
      matricNumber: "M/2",
      fullName: "Bob",
      status: "ACTIVE",
    });
    const courses = new FakeCourseRepo();
    const c1 = await courses.create({
      code: "CS201",
      title: "Algorithms",
      creditValue: 3,
      courseType: "CORE",
    });
    const results = new FakeResultRepo();
    // NORMAL row — F grade (gradePoint 0)
    results.rows.push({
      id: "rN",
      studentId: student.id,
      courseId: c1.id,
      semesterId: "sem1",
      componentScores: [],
      finalScore: 30,
      grade: "F",
      gradePoint: 0,
      creditsEarned: 0,
      isLocked: true,
      sitting: "NORMAL" as const,
      status: "GRADED" as const,
    });
    // RESIT row — pass grade (gradePoint 3)
    results.rows.push({
      id: "rR",
      studentId: student.id,
      courseId: c1.id,
      semesterId: "sem1",
      componentScores: [],
      finalScore: 70,
      grade: "B",
      gradePoint: 3,
      creditsEarned: 3,
      isLocked: true,
      sitting: "RESIT" as const,
      status: "GRADED" as const,
    });

    const ordering = fakeSemesterOrdering({
      sem1: { sessionOrder: 0, rank: 0 },
    });
    const builder = new BuildReportData(
      students,
      institutions,
      results,
      courses,
      names,
      grading(),
      ordering,
    );
    const data = await builder.assemble(
      student.id,
      "TR-8",
      "2026-01-01T00:00:00.000Z",
    );

    // Both attempts must appear
    const allCourses = data.sessions.flatMap((s) => s.courses);
    expect(allCourses).toHaveLength(2);

    // The RESIT row must carry afterReattempt===true; the NORMAL row must not
    const normalRow = allCourses.find((c) => c.grade === "F");
    const resitRow = allCourses.find((c) => c.grade === "B");
    expect(normalRow?.afterReattempt).toBeUndefined();
    expect(resitRow?.afterReattempt).toBe(true);

    // Legend must mention Resit/Retake
    expect(data.legendNotes).toBeDefined();
    expect(data.legendNotes!.some((n) => /Resit\/Retake/.test(n))).toBe(true);
  });

  it("discounts the original F from semester GPA and CGPA; only resit counts", async () => {
    const students = new FakeStudentRepo();
    const student = await students.create({
      matricNumber: "M/3",
      fullName: "Carol",
      status: "ACTIVE",
    });
    const courses = new FakeCourseRepo();
    const c1 = await courses.create({
      code: "CS301",
      title: "OS",
      creditValue: 3,
      courseType: "CORE",
    });
    const results = new FakeResultRepo();
    // NORMAL attempt — F, gradePoint 0
    results.rows.push({
      id: "rN2",
      studentId: student.id,
      courseId: c1.id,
      semesterId: "sem1",
      componentScores: [],
      grade: "F",
      gradePoint: 0,
      creditsEarned: 0,
      isLocked: true,
      sitting: "NORMAL" as const,
      status: "GRADED" as const,
    });
    // RESIT attempt — pass, gradePoint 3 (B)
    results.rows.push({
      id: "rR2",
      studentId: student.id,
      courseId: c1.id,
      semesterId: "sem1",
      componentScores: [],
      grade: "B",
      gradePoint: 3,
      creditsEarned: 3,
      isLocked: true,
      sitting: "RESIT" as const,
      status: "GRADED" as const,
    });

    const ordering = fakeSemesterOrdering({
      sem1: { sessionOrder: 0, rank: 0 },
    });
    const builder = new BuildReportData(
      students,
      institutions,
      results,
      courses,
      names,
      grading(),
      ordering,
    );
    const data = await builder.assemble(
      student.id,
      "TR-9",
      "2026-01-01T00:00:00.000Z",
    );

    // CGPA must equal the resit's gradePoint (3) — not (0+3)/2=1.5
    expect(data.summary.cgpa).toBe(3);
    // Semester GPA must also reflect only the effective resit
    expect(data.sessions[0]!.semesterGpa).toBe(3);
  });

  it("cross-session carryover: F in session1, pass in session2, F discounted from CGPA", async () => {
    const students = new FakeStudentRepo();
    const student = await students.create({
      matricNumber: "M/4",
      fullName: "Dave",
      status: "ACTIVE",
    });
    const courses = new FakeCourseRepo();
    const c1 = await courses.create({
      code: "CS401",
      title: "Networks",
      creditValue: 3,
      courseType: "CORE",
    });
    const results = new FakeResultRepo();
    // Earlier session — NORMAL attempt — F
    results.rows.push({
      id: "rOld",
      studentId: student.id,
      courseId: c1.id,
      semesterId: "sem1",
      componentScores: [],
      grade: "F",
      gradePoint: 0,
      creditsEarned: 0,
      isLocked: true,
      sitting: "NORMAL" as const,
      status: "GRADED" as const,
    });
    // Later session — NORMAL attempt — pass
    results.rows.push({
      id: "rNew",
      studentId: student.id,
      courseId: c1.id,
      semesterId: "sem2",
      componentScores: [],
      grade: "A",
      gradePoint: 4,
      creditsEarned: 3,
      isLocked: true,
      sitting: "NORMAL" as const,
      status: "GRADED" as const,
    });

    // sem2 is chronologically later (sessionOrder 1)
    const ordering = fakeSemesterOrdering({
      sem1: { sessionOrder: 0, rank: 0 },
      sem2: { sessionOrder: 1, rank: 0 },
    });
    const builder = new BuildReportData(
      students,
      institutions,
      results,
      courses,
      names,
      grading(),
      ordering,
    );
    const data = await builder.assemble(
      student.id,
      "TR-10",
      "2026-01-01T00:00:00.000Z",
    );

    // Both sessions appear; cross-session carryover means sem2's attempt is reattempt
    const allCourses = data.sessions.flatMap((s) => s.courses);
    expect(allCourses).toHaveLength(2);

    // The pass in sem2 is a reattempt
    const passRow = allCourses.find((c) => c.grade === "A");
    expect(passRow?.afterReattempt).toBe(true);

    // Sessions ordered chronologically: sem1 first
    expect(data.sessions[0]!.courses[0]!.grade).toBe("F");
    expect(data.sessions[1]!.courses[0]!.grade).toBe("A");

    // CGPA = only the pass (gradePoint 4) counts; F discounted
    expect(data.summary.cgpa).toBe(4);
  });

  it("a plain transcript (no reattempts, no markers) has no legendNotes", async () => {
    const students = new FakeStudentRepo();
    const student = await students.create({
      matricNumber: "M/5",
      fullName: "Eve",
      status: "ACTIVE",
    });
    const courses = new FakeCourseRepo();
    const c1 = await courses.create({
      code: "CS501",
      title: "AI",
      creditValue: 3,
      courseType: "CORE",
    });
    const results = new FakeResultRepo();
    results.rows.push({
      id: "rPlain",
      studentId: student.id,
      courseId: c1.id,
      semesterId: "sem1",
      componentScores: [],
      grade: "A",
      gradePoint: 4,
      creditsEarned: 3,
      isLocked: true,
      sitting: "NORMAL" as const,
      status: "GRADED" as const,
    });

    const builder = new BuildReportData(
      students,
      institutions,
      results,
      courses,
      names,
      grading(),
      trivialOrdering,
    );
    const data = await builder.assemble(
      student.id,
      "TR-11",
      "2026-01-01T00:00:00.000Z",
    );

    expect(data.legendNotes).toBeUndefined();
  });
});
