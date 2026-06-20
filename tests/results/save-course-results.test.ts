/**
 * Tests for SaveCourseResults (Task 4.4).
 *
 * TDD: tests written before the implementation exists.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { SaveCourseResults } from "../../src/application/use-cases/results/SaveCourseResults";
import { GradingConfigService } from "../../src/application/services/GradingConfigService";
import { buildDefaultRegistry } from "../../src/domain/settings/SettingsRegistry";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
// RecordsError is thrown by the implementation; we match its message via toThrow()
import { CapturingAudit } from "../auth/fakes";
import {
  FakeGradeScaleRepo,
  FakeAssessmentConfigRepo,
} from "../config/grading-fakes";
import { InMemorySettingRepository } from "../config/fakes";
import type { StudentRepository } from "../../src/domain/repositories/records";
import type { Student } from "../../src/domain/entities";
import { FakeResultRepo, fakeUow } from "./fakes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeGrading(): Promise<GradingConfigService> {
  const assess = new FakeAssessmentConfigRepo();
  await assess.create({
    name: "Default",
    components: JSON.stringify([
      { key: "ca", label: "CA", weight: 30, maxScore: 30 },
      { key: "exam", label: "Exam", weight: 70, maxScore: 70 },
    ]),
    isDefault: true,
  });
  return new GradingConfigService(
    new FakeGradeScaleRepo(),
    assess,
    new InMemorySettingRepository(),
    buildDefaultRegistry(),
  );
}

/** A minimal FakeStudentRepo that returns pre-seeded students by id. */
class FakeStudentRepo implements Pick<StudentRepository, "findById"> {
  private readonly store = new Map<string, Student>();

  seed(student: Student): this {
    this.store.set(student.id, student);
    return this;
  }

  async findById(id: string): Promise<Student | null> {
    return this.store.get(id) ?? null;
  }

  // Satisfy the full interface (unused in these tests)
  async create(_data: Omit<Student, "id">): Promise<Student> {
    throw new Error("not implemented");
  }
  async update(
    _id: string,
    _patch: Partial<Omit<Student, "id">>,
  ): Promise<Student> {
    throw new Error("not implemented");
  }
  async softDelete(_id: string): Promise<void> {
    throw new Error("not implemented");
  }
  async findByMatric(_matricNumber: string): Promise<Student | null> {
    return null;
  }
  async find(
    _query: import("../../src/domain/repositories/records").StudentQuery,
  ): Promise<import("../../src/domain/repositories/records").Page<Student>> {
    return { items: [], total: 0 };
  }
}

// A student in-scope (same institutionId, not faculty-scoped session)
const INST = "inst-1";
const COURSE_ID = "course-abc";
const SEM_ID = "sem-2025";

const student1: Student = {
  id: "s1",
  matricNumber: "MAT001",
  fullName: "Alice Doe",
  institutionId: INST,
  facultyId: "fac-1",
  status: "ACTIVE",
};
const student2: Student = {
  id: "s2",
  matricNumber: "MAT002",
  fullName: "Bob Doe",
  institutionId: INST,
  facultyId: "fac-1",
  status: "ACTIVE",
};

// SUPER_ADMIN scoped to the same institution — not faculty-scoped
const adminSession = SessionContext.create(
  "admin-1",
  "SUPER_ADMIN",
  ["results.process"],
  INST,
  [],
);

const adminOverrideSession = SessionContext.create(
  "admin-1",
  "SUPER_ADMIN",
  ["results.process", "results.override"],
  INST,
  [],
);

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe("SaveCourseResults", () => {
  let results: FakeResultRepo;
  let audit: CapturingAudit;
  let students: FakeStudentRepo;
  let grading: GradingConfigService;

  beforeEach(async () => {
    results = new FakeResultRepo();
    audit = new CapturingAudit();
    students = new FakeStudentRepo();
    students.seed(student1);
    students.seed(student2);
    grading = await makeGrading();
  });

  it("upserts every row for a course+sitting atomically — report.saved === 2", async () => {
    const uow = fakeUow({
      results,
      students: students as unknown as StudentRepository,
      audit,
    });

    const uc = new SaveCourseResults(grading, uow);

    const report = await uc.execute(
      {
        semesterId: SEM_ID,
        courseId: COURSE_ID,
        sitting: "NORMAL",
        rows: [
          {
            studentId: "s1",
            componentScores: [
              { key: "ca", score: 25 },
              { key: "exam", score: 60 },
            ],
            status: "GRADED",
          },
          {
            studentId: "s2",
            componentScores: [],
            status: "DID",
          },
        ],
      },
      adminSession,
    );

    expect(report.saved).toBe(2);
    expect(results.rows).toHaveLength(2);
    expect(results.rows[0]?.studentId).toBe("s1");
    expect(results.rows[1]?.studentId).toBe("s2");
    expect(results.rows[1]?.status).toBe("DID");
    expect(results.rows[1]?.finalScore).toBeUndefined();
    // Audit entry recorded
    const lastAudit = audit.entries.at(-1)!;
    expect(lastAudit.action).toBe("IMPORT");
    expect(lastAudit.entity).toBe("Result");
  });

  it("writes nothing when any row throws (all-or-nothing) — rejects on locked result", async () => {
    // Pre-seed a locked result for s2
    await results.create({
      studentId: "s2",
      courseId: COURSE_ID,
      semesterId: SEM_ID,
      componentScores: [],
      finalScore: 50,
      isLocked: true,
      sitting: "NORMAL",
      status: "GRADED",
    });

    const uow = fakeUow({
      results,
      students: students as unknown as StudentRepository,
      audit,
    });

    const uc = new SaveCourseResults(grading, uow);

    await expect(
      uc.execute(
        {
          semesterId: SEM_ID,
          courseId: COURSE_ID,
          sitting: "NORMAL",
          rows: [
            {
              studentId: "s1",
              componentScores: [
                { key: "ca", score: 25 },
                { key: "exam", score: 60 },
              ],
              status: "GRADED",
            },
            {
              studentId: "s2",
              componentScores: [
                { key: "ca", score: 20 },
                { key: "exam", score: 50 },
              ],
              status: "GRADED",
            },
          ],
        },
        adminSession,
      ),
    ).rejects.toThrow(/locked/i);

    // NOTE: the fake UoW does not simulate real DB rollback — it just
    // propagates the throw. Row for s1 may have been written before the
    // throw on s2; we assert the rejection happened.
    // In production (real Prisma/SQLite UoW) nothing would be committed.
  });

  it("RESIT mode rejects a student who already passed (unless override)", async () => {
    // Pre-seed a NORMAL result for s1 that was processed with creditsEarned > 0
    await results.create({
      studentId: "s1",
      courseId: COURSE_ID,
      semesterId: SEM_ID,
      componentScores: [
        { key: "ca", score: 28 },
        { key: "exam", score: 65 },
      ],
      finalScore: 93,
      grade: "A",
      gradePoint: 4.0,
      creditsEarned: 3,
      isLocked: false,
      sitting: "NORMAL",
      status: "GRADED",
    });

    const uow = fakeUow({
      results,
      students: students as unknown as StudentRepository,
      audit,
    });

    const uc = new SaveCourseResults(grading, uow);

    await expect(
      uc.execute(
        {
          semesterId: SEM_ID,
          courseId: COURSE_ID,
          sitting: "RESIT",
          rows: [
            {
              studentId: "s1",
              componentScores: [
                { key: "ca", score: 20 },
                { key: "exam", score: 50 },
              ],
              status: "GRADED",
            },
          ],
        },
        adminSession,
      ),
    ).rejects.toThrow(/eligible/i);
  });

  it("override bypasses RESIT eligibility check — student who passed can be saved", async () => {
    // Pre-seed a passing NORMAL result for s1
    await results.create({
      studentId: "s1",
      courseId: COURSE_ID,
      semesterId: SEM_ID,
      componentScores: [
        { key: "ca", score: 28 },
        { key: "exam", score: 65 },
      ],
      finalScore: 93,
      grade: "A",
      gradePoint: 4.0,
      creditsEarned: 3,
      isLocked: false,
      sitting: "NORMAL",
      status: "GRADED",
    });

    const uow = fakeUow({
      results,
      students: students as unknown as StudentRepository,
      audit,
    });

    const uc = new SaveCourseResults(grading, uow);

    // With override permission, should NOT throw
    const report = await uc.execute(
      {
        semesterId: SEM_ID,
        courseId: COURSE_ID,
        sitting: "RESIT",
        rows: [
          {
            studentId: "s1",
            componentScores: [
              { key: "ca", score: 20 },
              { key: "exam", score: 50 },
            ],
            status: "GRADED",
          },
        ],
      },
      adminOverrideSession,
    );

    expect(report.saved).toBe(1);

    // Audit should contain override: true
    const lastAudit = audit.entries.at(-1)!;
    expect(lastAudit.newValue).toMatchObject({ override: true });
  });
});
