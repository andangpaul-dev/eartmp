import { describe, it, expect } from "vitest";
import { GradeScale } from "../src/domain/value-objects/GradeScale";
import { ProcessSemesterResults } from "../src/application/use-cases/ProcessSemesterResults";
import type {
  UnitOfWork,
  TransactionalRepos,
} from "../src/application/ports/UnitOfWork";
import type {
  CourseRepository,
  ResultRepository,
  StudentRepository,
  StudentEnrollmentRepository,
  SemesterOrdering,
  MatriculeCounterRepository,
} from "../src/domain/repositories/records";
import type { AuditLogPort } from "../src/domain/repositories";
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

// Minimal in-memory fakes wired into a fake UnitOfWork — proves the use-case
// needs no real DB and runs inside a transaction boundary.
function makeUow() {
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
      sitting: "NORMAL",
      status: "GRADED",
    },
    {
      id: "r2",
      studentId: "s1",
      courseId: "c2",
      semesterId: "sem1",
      componentScores: [],
      finalScore: 30,
      isLocked: false,
      sitting: "NORMAL",
      status: "GRADED",
    },
  ];
  const updates: Record<
    string,
    { grade: string; gradePoint: number; creditsEarned: number }
  > = {};
  const auditEntries: unknown[] = [];

  const results = {
    async findByStudentAndSemester(sid: string, sem: string) {
      return resultTable.filter(
        (r) => r.studentId === sid && r.semesterId === sem,
      );
    },
    async updateProcessed(id, data) {
      updates[id] = {
        grade: data.grade,
        gradePoint: data.gradePoint,
        creditsEarned: data.creditsEarned,
      };
    },
    // Unused by this use-case — minimal stubs to satisfy the full port.
    async create(d) {
      return { ...d, id: "new" };
    },
    async findById() {
      return null;
    },
    async existsFor() {
      return false;
    },
    async findByStudent(studentId: string) {
      return resultTable.filter((r) => r.studentId === studentId);
    },
    async updateScores() {},
    async setLockedForSemester() {
      return 0;
    },
    async unlock() {},
  } satisfies ResultRepository;

  const courses = {
    async findById(id: string) {
      return courseTable[id] ?? null;
    },
    async findByCode() {
      return null;
    },
    async create(e) {
      return { ...e, id: "new" };
    },
    async update(_id, _p) {
      return Object.values(courseTable)[0]!;
    },
    async softDelete() {},
    async find() {
      return { items: Object.values(courseTable), total: 2 };
    },
  } satisfies CourseRepository;

  const audit: AuditLogPort = {
    async record(e) {
      auditEntries.push(e);
    },
  };

  // Students/enrollments unused by this use-case — minimal stubs.
  const students = {} as StudentRepository;
  const enrollments = {} as StudentEnrollmentRepository;
  const semesterOrdering: SemesterOrdering = {
    async order(ids) {
      return new Map(ids.map((id) => [id, { sessionOrder: 0, rank: 0 }]));
    },
  };
  const matriculeCounter: MatriculeCounterRepository = {
    async peek() {
      return 1;
    },
    async reserve() {
      return 1;
    },
  };

  const uow: UnitOfWork = {
    run<T>(work: (repos: TransactionalRepos) => Promise<T>) {
      return work({
        students,
        enrollments,
        courses,
        results,
        audit,
        semesterOrdering,
        matriculeCounter,
      });
    },
  };

  return { uow, updates, auditEntries };
}

describe("ProcessSemesterResults use-case", () => {
  it("computes GPA, persists grades, and writes an audit entry", async () => {
    const { uow, updates, auditEntries } = makeUow();
    const uc = new ProcessSemesterResults(uow);

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
    const { uow } = makeUow();
    const uc = new ProcessSemesterResults(uow);
    await expect(
      uc.execute({ studentId: "ghost", semesterId: "sem1", scale }),
    ).rejects.toThrow(/No results/);
  });
});
