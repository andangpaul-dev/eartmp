/**
 * Unit tests for ListCourseRoster (Task 4.3 — enrollment-history course roster).
 */
import { describe, it, expect } from "vitest";
import { ListCourseRoster } from "../../src/application/use-cases/results/CourseRoster";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import type {
  StudentRepository,
  CourseRepository,
  StudentEnrollmentRepository,
  Page,
  StudentQuery,
} from "../../src/domain/repositories/records";
import type { Student, Course } from "../../src/domain/entities";
import type { StudentEnrollment } from "../../src/domain/entities/enrollment";
import { RecordsError } from "../../src/domain/errors/records";

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
const session = SessionContext.create("u", "REGISTRAR", ["results.read"]);

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeCourseRepo(course: Course | null): CourseRepository {
  return {
    findById: async () => course,
    findByCode: async () => null,
    create: async (d) => ({ id: "c1", ...d }) as Course,
    update: async (id, p) => ({ id, ...p }) as Course,
    softDelete: async () => undefined,
    find: async () => ({ items: [], total: 0 }),
  };
}

/** Returns a fixed set of students regardless of filter (we trust the filter is set) */
function makeStudentRepo(items: Student[]): StudentRepository {
  return {
    findById: async (id) => items.find((s) => s.id === id) ?? null,
    findByMatric: async () => null,
    create: async (d) => ({ id: "sx", ...d }) as Student,
    update: async (id, p) => ({ id, ...p }) as Student,
    softDelete: async () => undefined,
    find: async (_q: StudentQuery): Promise<Page<Student>> => ({
      items,
      total: items.length,
    }),
  };
}

function makeEnrollmentRepo(
  map: Record<string, StudentEnrollment[]>,
): StudentEnrollmentRepository {
  return {
    create: async (d) => ({ id: "e1", ...d }),
    findCurrent: async () => null,
    closeCurrent: async () => undefined,
    listByStudent: async (id) => map[id] ?? [],
    reassignStudent: async () => 0,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROG_P = "prog-P";
const LEVEL_L = "level-L";

const course: Course = {
  id: "course-1",
  code: "CS101",
  title: "Intro to CS",
  creditValue: 3,
  courseType: "CORE",
  programmeId: PROG_P,
  levelId: LEVEL_L,
};

const s1: Student = {
  id: "s1",
  matricNumber: "M001",
  fullName: "Alice",
  status: "ACTIVE",
  programmeId: PROG_P,
  levelId: LEVEL_L,
};

// s2 is in a different programme — the fake students.find already excludes it
// (it only returns the candidate set; see test description). Kept here as a
// fixture comment to document the intent.
const _s2: Student = {
  id: "s2",
  matricNumber: "M002",
  fullName: "Bob",
  status: "ACTIVE",
  programmeId: "other-prog",
  levelId: LEVEL_L,
};

const s3: Student = {
  id: "s3",
  matricNumber: "M003",
  fullName: "Carol",
  status: "ACTIVE",
  programmeId: PROG_P,
  levelId: LEVEL_L,
};

const s4: Student = {
  id: "s4",
  matricNumber: "M004",
  fullName: "Dave",
  status: "ACTIVE",
  programmeId: PROG_P,
  levelId: LEVEL_L,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ListCourseRoster", () => {
  it("rosters students enrolled in the course's programme/level as of the session", async () => {
    // s1 has an active enrollment span in P/L starting from 2024/2025 (no end, isCurrent)
    // s2 is in a different programme → students.find returns only s1 (fake simulates the filter)
    const useCase = new ListCourseRoster(
      makeStudentRepo([s1]),
      makeEnrollmentRepo({
        s1: [
          {
            id: "e1",
            studentId: "s1",
            programmeId: PROG_P,
            levelId: LEVEL_L,
            fromSession: "2024/2025",
            isCurrent: true,
          },
        ],
      }),
      makeCourseRepo(course),
    );

    const result = await authorize(
      useCase,
      { courseId: "course-1", sessionName: "2025/2026" },
      session,
    );
    expect(result.map((s) => s.id)).toEqual(["s1"]);
  });

  it("falls back to current placement when a student has no enrollment row", async () => {
    // s3 returned by find() but has no enrollment spans → legacy fallback: included
    const useCase = new ListCourseRoster(
      makeStudentRepo([s3]),
      makeEnrollmentRepo({}), // empty map → listByStudent returns []
      makeCourseRepo(course),
    );

    const result = await authorize(
      useCase,
      { courseId: "course-1", sessionName: "2025/2026" },
      session,
    );
    expect(result.map((s) => s.id)).toEqual(["s3"]);
  });

  it("excludes a student whose enrollment span does NOT cover the session", async () => {
    // s4 returned by find() but only has a span starting 2026/2027 (future, not current)
    const useCase = new ListCourseRoster(
      makeStudentRepo([s4]),
      makeEnrollmentRepo({
        s4: [
          {
            id: "e2",
            studentId: "s4",
            programmeId: PROG_P,
            levelId: LEVEL_L,
            fromSession: "2026/2027",
            isCurrent: false,
          },
        ],
      }),
      makeCourseRepo(course),
    );

    const result = await authorize(
      useCase,
      { courseId: "course-1", sessionName: "2025/2026" },
      session,
    );
    expect(result).toHaveLength(0);
  });

  it("throws RecordsError when the course is not found", async () => {
    const useCase = new ListCourseRoster(
      makeStudentRepo([]),
      makeEnrollmentRepo({}),
      makeCourseRepo(null),
    );

    await expect(
      authorize(
        useCase,
        { courseId: "missing", sessionName: "2025/2026" },
        session,
      ),
    ).rejects.toThrow(RecordsError);
  });
});
