/**
 * ReadmitStudent tests (Phase 5 Workstream C).
 *
 * WITHDRAWN → reactivate SAME record, keep matricule + admissionSession.
 * GRADUATED → create NEW record with new matricule + previousStudentId.
 * ACTIVE    → reject.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ReadmitStudent } from "../../src/application/use-cases/records/ReadmitStudent";
import { RecordsError } from "../../src/domain/errors/records";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import type {
  GenerateMatricule,
  MatriculeContext,
  MatriculeMode,
} from "../../src/application/services/GenerateMatricule";
import type { TransactionalRepos } from "../../src/application/ports/UnitOfWork";
import { fakeUow } from "../results/fakes";
import { FakeStudentRepo, FakeEnrollmentRepo } from "./fakes";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "students.update",
  "students.read",
]);

// Fake GenerateMatricule that returns a predictable string for "reserve"
// and a different string for "peek" so we can distinguish them in tests.
let genCallCount = 0;
const fakeGenerate: GenerateMatricule = {
  async generate(
    _ctx: MatriculeContext,
    _repos: TransactionalRepos,
    mode: MatriculeMode,
  ) {
    if (mode === "reserve") {
      genCallCount++;
      return `NEW-MATRIC-${genCallCount}`;
    }
    return "PEEK-MATRIC";
  },
} as unknown as GenerateMatricule;

let students: FakeStudentRepo;
let enrollments: FakeEnrollmentRepo;

beforeEach(() => {
  students = new FakeStudentRepo();
  enrollments = new FakeEnrollmentRepo();
  genCallCount = 0;
});

function makeUow() {
  return fakeUow({ students, enrollments });
}

describe("ReadmitStudent", () => {
  it("WITHDRAWN: reactivates SAME record, keeps matricule + admission session", async () => {
    // Set up a withdrawn student
    const original = await students.create({
      matricNumber: "WD/2020/001",
      fullName: "Grace Hopper",
      status: "WITHDRAWN",
      admissionSession: "2020/2021",
      facultyId: "facA",
      programmeId: "progA",
      levelId: "lvl1",
    });
    // Give them a closed enrollment
    await enrollments.create({
      studentId: original.id,
      programmeId: "progA",
      levelId: "lvl1",
      fromSession: "2020/2021",
      isCurrent: false,
      toSession: "2021/2022",
    });

    const uc = new ReadmitStudent(makeUow(), fakeGenerate);
    const result = await uc.execute(
      {
        studentId: original.id,
        programmeId: "progB",
        levelId: "lvl2",
        fromSession: "2024/2025",
      },
      admin,
    );

    // Same record: same id, same matricNumber, same admissionSession
    expect(result.id).toBe(original.id);
    expect(result.matricNumber).toBe("WD/2020/001");
    expect(result.admissionSession).toBe("2020/2021");
    expect(result.status).toBe("ACTIVE");

    // A new current enrollment was opened
    const current = await enrollments.findCurrent(original.id);
    expect(current).not.toBeNull();
    expect(current?.programmeId).toBe("progB");

    // No new matricule generated (withdrawn re-use path)
    expect(genCallCount).toBe(0);
  });

  it("GRADUATED: creates NEW record with new matricule + previousStudentId", async () => {
    // Set up a graduated student with personal details
    const original = await students.create({
      matricNumber: "GR/2018/001",
      fullName: "Alan Turing",
      gender: "M",
      nationality: "British",
      email: "alan@example.com",
      status: "GRADUATED",
      admissionSession: "2018/2019",
      facultyId: "facA",
      departmentId: "deptCS",
      programmeId: "progA",
      levelId: "lvl4",
    });

    const uc = new ReadmitStudent(makeUow(), fakeGenerate);
    const result = await uc.execute(
      {
        studentId: original.id,
        programmeId: "progB",
        levelId: "lvl1",
        fromSession: "2024/2025",
        facultyId: "facA",
        departmentId: "deptCS",
      },
      admin,
    );

    // NEW record: different id, different matricNumber
    expect(result.id).not.toBe(original.id);
    expect(result.matricNumber).toBe("NEW-MATRIC-1");
    expect(genCallCount).toBe(1);

    // previousStudentId links back to the original
    expect(result.previousStudentId).toBe(original.id);

    // Personal details copied
    expect(result.fullName).toBe("Alan Turing");
    expect(result.gender).toBe("M");
    expect(result.nationality).toBe("British");
    expect(result.email).toBe("alan@example.com");

    // New placement
    expect(result.admissionSession).toBe("2024/2025");
    expect(result.programmeId).toBe("progB");
    expect(result.levelId).toBe("lvl1");
    expect(result.status).toBe("ACTIVE");

    // A new current enrollment was opened for the new record
    const current = await enrollments.findCurrent(result.id);
    expect(current).not.toBeNull();
    expect(current?.programmeId).toBe("progB");
  });

  it("rejects readmit of an ACTIVE student", async () => {
    const active = await students.create({
      matricNumber: "AC/2023/001",
      fullName: "Ada Lovelace",
      status: "ACTIVE",
      admissionSession: "2023/2024",
      facultyId: "facA",
      programmeId: "progA",
      levelId: "lvl1",
    });

    const uc = new ReadmitStudent(makeUow(), fakeGenerate);
    await expect(
      uc.execute(
        {
          studentId: active.id,
          programmeId: "progA",
          levelId: "lvl1",
          fromSession: "2024/2025",
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(RecordsError);
  });

  it("rejects readmit of a non-existent student", async () => {
    const uc = new ReadmitStudent(makeUow(), fakeGenerate);
    await expect(
      uc.execute(
        {
          studentId: "does-not-exist",
          programmeId: "progA",
          levelId: "lvl1",
          fromSession: "2024/2025",
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(RecordsError);
  });
});
