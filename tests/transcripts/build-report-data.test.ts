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

const institution: Institution = {
  id: "i1",
  name: "Example University",
  motto: "Knowledge",
  calendarType: "SEMESTER",
};
const institutions: InstitutionRepository = {
  async get() {
    return institution;
  },
  async update() {
    return institution;
  },
};

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
    });

    const builder = new BuildReportData(
      students,
      institutions,
      results,
      courses,
      names,
      grading(),
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
    );
    await expect(builder.assemble("ghost", "TR-1", "x")).rejects.toBeInstanceOf(
      TranscriptError,
    );
  });
});
