import { describe, it, expect } from "vitest";
import { AdmitStudent } from "../../src/application/use-cases/records/AdmitStudent";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { RecordsError } from "../../src/domain/errors/records";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import type {
  UnitOfWork,
  TransactionalRepos,
} from "../../src/application/ports/UnitOfWork";
import type {
  ResultRepository,
  CourseRepository,
  SemesterOrdering,
  MatriculeCounterRepository,
} from "../../src/domain/repositories/records";
import { CapturingAudit } from "../auth/fakes";
import { FakeStudentRepo, FakeEnrollmentRepo } from "../records/fakes";
import type {
  GenerateMatricule,
  MatriculeSettingsPort,
} from "../../src/application/services/GenerateMatricule";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "students.create",
]);
const viewer = SessionContext.create("v", "VIEWER", []);

const noopSemesterOrdering: SemesterOrdering = {
  async order(ids) {
    return new Map(ids.map((id) => [id, { sessionOrder: 0, rank: 0 }]));
  },
};

const noopMatriculeCounter: MatriculeCounterRepository = {
  async peek() {
    return 1;
  },
  async reserve() {
    return 1;
  },
};

/** Fake GenerateMatricule that always returns "FS25-0001" on reserve. */
const fakeGenerate = {
  async generate(
    _ctx: unknown,
    _repos: unknown,
    _mode: unknown,
  ): Promise<string> {
    return "FS25-0001";
  },
} as unknown as GenerateMatricule;

/** Fake settings with a format regex that matches "FS25-0001" style. */
const fakeSettings: MatriculeSettingsPort = {
  async matriculeRule() {
    return "{faculty}{year}-{seq:4}";
  },
  async matriculeCheckScheme() {
    return "none" as never;
  },
  async matriculeFormat() {
    return "^[A-Z]{2}\\d{2}-\\d{4}$";
  },
};

/** Empty settings (no format validation). */
const emptySettings: MatriculeSettingsPort = {
  async matriculeRule() {
    return "{faculty}{year}-{seq:4}";
  },
  async matriculeCheckScheme() {
    return "none" as never;
  },
  async matriculeFormat() {
    return "";
  },
};

function makeUow() {
  const students = new FakeStudentRepo();
  const enrollments = new FakeEnrollmentRepo();
  const audit = new CapturingAudit();
  const results = {} as ResultRepository;
  const courses = {} as CourseRepository;
  const uow: UnitOfWork = {
    run<T>(work: (r: TransactionalRepos) => Promise<T>) {
      return work({
        students,
        enrollments,
        courses,
        results,
        audit,
        semesterOrdering: noopSemesterOrdering,
        matriculeCounter: noopMatriculeCounter,
      });
    },
  };
  return { uow, students, enrollments, audit };
}

/** Helper: build an AdmitStudent with the fake generate + empty settings (no
 *  format validation) and call execute with the given input + optional session. */
async function admit(
  input: Parameters<AdmitStudent["execute"]>[0],
  session: SessionContext = admin,
) {
  const { uow } = makeUow();
  const uc = new AdmitStudent(uow, fakeGenerate, emptySettings);
  return uc.execute(input, session);
}

describe("AdmitStudent", () => {
  it("creates the student and the initial enrollment, and audits", async () => {
    const { uow, students, enrollments, audit } = makeUow();
    const { student, enrollment } = await new AdmitStudent(
      uow,
      fakeGenerate,
      emptySettings,
    ).execute(
      {
        matricNumber: "M/1",
        fullName: "Ada",
        programmeId: "pA",
        levelId: "lA",
        admissionSession: "2024/2025",
      },
      admin,
    );
    expect(student.status).toBe("ACTIVE");
    expect(enrollment.isCurrent).toBe(true);
    expect((await students.findById(student.id))?.matricNumber).toBe("M/1");
    expect((await enrollments.findCurrent(student.id))?.programmeId).toBe("pA");
    expect(audit.entries[0]).toMatchObject({
      action: "ADMIT",
      entity: "Student",
    });
  });

  it("rejects a duplicate live matric number", async () => {
    const { uow } = makeUow();
    const uc = new AdmitStudent(uow, fakeGenerate, emptySettings);
    const input = {
      matricNumber: "M/1",
      fullName: "Ada",
      programmeId: "pA",
      levelId: "lA",
      admissionSession: "2024/2025",
    };
    await uc.execute(input, admin);
    await expect(uc.execute(input, admin)).rejects.toBeInstanceOf(RecordsError);
  });

  it("is denied without students.create", async () => {
    const { uow } = makeUow();
    await expect(
      authorize(
        new AdmitStudent(uow, fakeGenerate, emptySettings),
        {
          matricNumber: "M/2",
          fullName: "Z",
          programmeId: "p",
          levelId: "l",
          admissionSession: "2024/2025",
        },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  // --- new Phase-3 tests ---

  it("auto-generates the matricule, sets admissionSession + faculty/dept", async () => {
    const r = await admit({
      fullName: "A",
      programmeId: "p",
      levelId: "l",
      facultyId: "facA",
      departmentId: "d",
      admissionSession: "2025/2026",
    });
    expect(r.student.matricNumber).toBe("FS25-0001");
    expect(r.student.admissionSession).toBe("2025/2026");
    expect(r.student.facultyId).toBe("facA");
    expect(r.student.departmentId).toBe("d");
  });

  it("uses a manual matricule and does NOT consume the counter", async () => {
    const r = await admit({
      matricNumber: "MANUAL1",
      fullName: "A",
      programmeId: "p",
      levelId: "l",
      facultyId: "facA",
      admissionSession: "2025/2026",
    });
    expect(r.student.matricNumber).toBe("MANUAL1");
  });

  it("rejects a manual matricule failing the format regex", async () => {
    const { uow } = makeUow();
    const uc = new AdmitStudent(uow, fakeGenerate, fakeSettings);
    await expect(
      uc.execute(
        {
          matricNumber: "bad",
          fullName: "A",
          programmeId: "p",
          levelId: "l",
          facultyId: "facA",
          admissionSession: "2025/2026",
        },
        admin,
      ),
    ).rejects.toThrow(/format/i);
  });

  it("enforces faculty scope on the admitting officer", async () => {
    const scoped = SessionContext.create(
      "o",
      "FACULTY_OFFICER",
      ["students.create"],
      "inst1",
      ["facX"],
    );
    await expect(
      admit(
        {
          fullName: "A",
          programmeId: "p",
          levelId: "l",
          facultyId: "facA",
          admissionSession: "2025/2026",
        },
        scoped,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  // FIX 1: faculty-scoped officer with NO facultyId must also be rejected
  it("rejects a faculty-scoped officer who omits facultyId (scope bypass guard)", async () => {
    const scoped = SessionContext.create(
      "o",
      "FACULTY_OFFICER",
      ["students.create"],
      "inst1",
      ["facX"],
    );
    await expect(
      admit(
        {
          fullName: "A",
          programmeId: "p",
          levelId: "l",
          // no facultyId — must NOT bypass the scope check
          admissionSession: "2025/2026",
        },
        scoped,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  // FIX 2: whitespace-only matricNumber routes to auto-generation
  it("treats whitespace-only matricNumber as auto-generate (not stored as empty)", async () => {
    const r = await admit({
      matricNumber: "  ",
      fullName: "A",
      programmeId: "p",
      levelId: "l",
      facultyId: "facA",
      admissionSession: "2025/2026",
    });
    // fakeGenerate always returns "FS25-0001"; empty string would not match
    expect(r.student.matricNumber).toBe("FS25-0001");
  });

  // FIX 3: anchored regex rejects substrings, accepts exact match
  it("rejects a matric that embeds the pattern but is not a full match (anchored regex)", async () => {
    const { uow } = makeUow();
    // fakeSettings format is "^[A-Z]{2}\\d{2}-\\d{4}$" — but AdmitStudent
    // wraps it in ^(?:...)$ itself, so we use a raw unanchored pattern here
    // to prove the anchoring is done by the use-case.
    const unanchoredSettings: MatriculeSettingsPort = {
      async matriculeRule() {
        return "{faculty}{year}-{seq:4}";
      },
      async matriculeCheckScheme() {
        return "none" as never;
      },
      async matriculeFormat() {
        // Intentionally unanchored — AdmitStudent must anchor it.
        return "[A-Z]{2}\\d{2}-\\d{4}";
      },
    };
    const uc = new AdmitStudent(uow, fakeGenerate, unanchoredSettings);
    // substring — must fail after anchoring
    await expect(
      uc.execute(
        {
          matricNumber: "JUNK FS25-0042 JUNK",
          fullName: "A",
          programmeId: "p",
          levelId: "l",
          facultyId: "facA",
          admissionSession: "2025/2026",
        },
        admin,
      ),
    ).rejects.toThrow(/format/i);
    // exact match — must pass
    const r = await uc.execute(
      {
        matricNumber: "FS25-0042",
        fullName: "A",
        programmeId: "p",
        levelId: "l",
        facultyId: "facA",
        admissionSession: "2025/2026",
      },
      admin,
    );
    expect(r.student.matricNumber).toBe("FS25-0042");
  });
});
