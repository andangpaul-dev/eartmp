import { describe, it, expect } from "vitest";
import { GradeScale } from "../src/domain/value-objects/GradeScale";
import { ProcessSemesterResults } from "../src/application/use-cases/ProcessSemesterResults";
import type {
  ResultRepository,
  CourseRepository,
  AuditLogPort,
} from "../src/domain/repositories";
import type { Course, ResultRecord } from "../src/domain/entities";

const scale = GradeScale.create([
  { minMark: 80, maxMark: 100, grade: "A", gradePoint: 4.0, isPass: true },
  { minMark: 70, maxMark: 79, grade: "B+", gradePoint: 3.5, isPass: true },
  { minMark: 60, maxMark: 69, grade: "B", gradePoint: 3.0, isPass: true },
  { minMark: 50, maxMark: 59, grade: "C+", gradePoint: 2.5, isPass: true },
  { minMark: 45, maxMark: 49, grade: "C", gradePoint: 2.0, isPass: true },
  { minMark: 40, maxMark: 44, grade: "D", gradePoint: 1.0, isPass: true },
  { minMark: 0, maxMark: 39, grade: "F", gradePoint: 0.0, isPass: false },
]);

// Minimal in-memory fakes — prove the use-case needs no real DB.
function makeFakes() {
  const courseTable: Record<string, Course> = {
    c1: {
      id: "c1",
      code: "CS101",
      title: "Intro",
      creditValue: 3,
      courseType: "CORE",
    },
    c2: {
      id: "c2",
      code: "MA101",
      title: "Calc",
      creditValue: 2,
      courseType: "CORE",
    },
  };
  const resultTable: ResultRecord[] = [
    {
      id: "r1",
      studentId: "s1",
      courseId: "c1",
      semesterId: "sem1",
      componentScores: [],
      finalScore: 85,
      isLocked: false,
    },
    {
      id: "r2",
      studentId: "s1",
      courseId: "c2",
      semesterId: "sem1",
      componentScores: [],
      finalScore: 30,
      isLocked: false,
    },
  ];
  const updates: Record<string, Partial<ResultRecord>> = {};
  const auditEntries: unknown[] = [];

  const results: ResultRepository = {
    async findById(id) {
      return resultTable.find((r) => r.id === id) ?? null;
    },
    async findAll() {
      return resultTable;
    },
    async create(e) {
      const x = { ...e, id: "new" } as ResultRecord;
      resultTable.push(x);
      return x;
    },
    async update(id, patch) {
      updates[id] = patch;
      const r = resultTable.find((x) => x.id === id)!;
      Object.assign(r, patch);
      return r;
    },
    async softDelete() {},
    async findByStudentAndSemester(sid, sem) {
      return resultTable.filter(
        (r) => r.studentId === sid && r.semesterId === sem,
      );
    },
    async findByStudent(sid) {
      return resultTable.filter((r) => r.studentId === sid);
    },
    async existsFor() {
      return false;
    },
  };
  const courses: CourseRepository = {
    async findById(id) {
      return courseTable[id] ?? null;
    },
    async findAll() {
      return Object.values(courseTable);
    },
    async create(e) {
      const x = { ...e, id: "new" } as Course;
      return x;
    },
    async update(_id, _p) {
      return Object.values(courseTable)[0]!;
    },
    async softDelete() {},
    async findByCode(code) {
      return Object.values(courseTable).find((c) => c.code === code) ?? null;
    },
    async findByProgramme() {
      return Object.values(courseTable);
    },
  };
  const audit: AuditLogPort = {
    async record(e) {
      auditEntries.push(e);
    },
  };
  return { results, courses, audit, updates, auditEntries };
}

describe("ProcessSemesterResults use-case", () => {
  it("computes GPA, persists grades, and writes an audit entry", async () => {
    const { results, courses, audit, updates, auditEntries } = makeFakes();
    const uc = new ProcessSemesterResults(results, courses, audit);

    const summary = await uc.execute({
      studentId: "s1",
      semesterId: "sem1",
      scale,
    });

    // CS101 A(4.0)*3=12, MA101 F(0)*2=0 => 12/5 = 2.4
    expect(summary.gpa).toBe(2.4);
    expect(summary.creditsEarned).toBe(3);
    expect(updates["r1"]!.grade).toBe("A");
    expect(updates["r2"]!.grade).toBe("F");
    expect(updates["r2"]!.creditsEarned).toBe(0);
    expect(auditEntries).toHaveLength(1);
  });

  it("throws when no results exist", async () => {
    const { results, courses, audit } = makeFakes();
    const uc = new ProcessSemesterResults(results, courses, audit);
    await expect(
      uc.execute({ studentId: "ghost", semesterId: "sem1", scale }),
    ).rejects.toThrow(/No results/);
  });
});
