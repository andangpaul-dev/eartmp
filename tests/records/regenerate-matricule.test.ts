/**
 * RegenerateMatricule tests (Phase 6 Workstream C).
 *
 * - Happy path: generates a new matricule for the student's (faculty, year)
 *   and persists it on the student record.
 * - Guard: refused when the student has APPROVED or LOCKED transcripts.
 * - Auth: faculty-scoped session cannot touch another faculty's student.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { RegenerateMatricule } from "../../src/application/use-cases/records/RegenerateMatricule";
import { RecordsError } from "../../src/domain/errors/records";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import type {
  GenerateMatricule,
  MatriculeContext,
  MatriculeMode,
} from "../../src/application/services/GenerateMatricule";
import type { TransactionalRepos } from "../../src/application/ports/UnitOfWork";
import { fakeUow, FakeTranscriptStore } from "../results/fakes";
import { FakeStudentRepo } from "./fakes";

// ---------------------------------------------------------------------------
// Fake GenerateMatricule
// ---------------------------------------------------------------------------
let reserveSeq = 0;
const fakeGenerate: GenerateMatricule = {
  async generate(
    ctx: MatriculeContext,
    _repos: TransactionalRepos,
    mode: MatriculeMode,
  ) {
    if (mode === "reserve") {
      reserveSeq++;
      // Mirror the faculty code abbreviation pattern used in real templates
      return `FS${String(ctx.admissionSession.match(/(\d{4})/)?.[1]).slice(-2)}-${String(reserveSeq).padStart(4, "0")}`;
    }
    return "PEEK";
  },
} as unknown as GenerateMatricule;

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "students.update",
  "students.read",
]);

// Faculty-A scoped officer
const facASession = SessionContext.create(
  "officer1",
  "FACULTY_ADMIN",
  ["students.update", "students.read"],
  "inst1",
  ["facA"],
);

// ---------------------------------------------------------------------------
// Repo + UoW helpers
// ---------------------------------------------------------------------------
let students: FakeStudentRepo;
let transcripts: FakeTranscriptStore;

beforeEach(() => {
  students = new FakeStudentRepo();
  transcripts = new FakeTranscriptStore();
  reserveSeq = 0;
});

function makeUow() {
  return fakeUow({ students, transcripts });
}

function makeUc() {
  return new RegenerateMatricule(makeUow(), fakeGenerate);
}

// Shorthand: execute as admin
async function regen(
  input: { studentId: string },
  session: SessionContext = admin,
) {
  return makeUc().execute(input, session);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("RegenerateMatricule", () => {
  it("regenerates the matricule for the student's (faculty, admission year)", async () => {
    // Arrange: a student in facA admitted in 2025/2026, no transcripts
    const student = await students.create({
      matricNumber: "OLD-0001",
      fullName: "Alice",
      status: "ACTIVE",
      facultyId: "facA",
      admissionSession: "2025/2026",
      programmeId: "progA",
      levelId: "lvl1",
    });

    // Act
    const result = await regen({ studentId: student.id });

    // Assert: new matricule returned
    expect(result.matricule).toBe("FS25-0001");

    // Assert: student row updated in the fake repo
    const updated = await students.findById(student.id);
    expect(updated?.matricNumber).toBe("FS25-0001");
  });

  it("refuses when the student has issued transcripts (APPROVED)", async () => {
    const student = await students.create({
      matricNumber: "OLD-0002",
      fullName: "Bob",
      status: "ACTIVE",
      facultyId: "facA",
      admissionSession: "2025/2026",
      programmeId: "progA",
      levelId: "lvl1",
    });

    // Simulate one APPROVED transcript
    transcripts.issuedCounts.set(student.id, 1);

    await expect(regen({ studentId: student.id })).rejects.toThrow(
      /transcript/i,
    );
  });

  it("refuses when the student has issued transcripts (LOCKED)", async () => {
    const student = await students.create({
      matricNumber: "OLD-0003",
      fullName: "Charlie",
      status: "ACTIVE",
      facultyId: "facA",
      admissionSession: "2025/2026",
      programmeId: "progA",
      levelId: "lvl1",
    });

    // Simulate locked transcripts (2 locked)
    transcripts.issuedCounts.set(student.id, 2);

    await expect(regen({ studentId: student.id })).rejects.toBeInstanceOf(
      RecordsError,
    );
  });

  it("throws RecordsError when the student does not exist", async () => {
    await expect(regen({ studentId: "does-not-exist" })).rejects.toBeInstanceOf(
      RecordsError,
    );
  });

  it("throws RecordsError when the student has no facultyId", async () => {
    const student = await students.create({
      matricNumber: "OLD-0004",
      fullName: "Dave",
      status: "ACTIVE",
      admissionSession: "2025/2026",
      programmeId: "progA",
      levelId: "lvl1",
    });

    await expect(regen({ studentId: student.id })).rejects.toBeInstanceOf(
      RecordsError,
    );
  });

  it("throws RecordsError when the student has no admissionSession", async () => {
    const student = await students.create({
      matricNumber: "OLD-0005",
      fullName: "Eve",
      status: "ACTIVE",
      facultyId: "facA",
      programmeId: "progA",
      levelId: "lvl1",
    });

    await expect(regen({ studentId: student.id })).rejects.toBeInstanceOf(
      RecordsError,
    );
  });

  it("is faculty-scoped: rejects a student in another faculty", async () => {
    // Student is in facB; facASession is scoped to facA only
    const student = await students.create({
      matricNumber: "OLD-0006",
      fullName: "Frank",
      status: "ACTIVE",
      facultyId: "facB",
      institutionId: "inst1",
      admissionSession: "2025/2026",
      programmeId: "progA",
      levelId: "lvl1",
    });

    await expect(
      regen({ studentId: student.id }, facASession),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("is faculty-scoped: allows a student in the officer's own faculty", async () => {
    // Student is in facA; facASession covers facA
    const student = await students.create({
      matricNumber: "OLD-0007",
      fullName: "Grace",
      status: "ACTIVE",
      facultyId: "facA",
      institutionId: "inst1",
      admissionSession: "2025/2026",
      programmeId: "progA",
      levelId: "lvl1",
    });

    const result = await regen({ studentId: student.id }, facASession);
    expect(result.matricule).toMatch(/^FS25-/);
  });

  it("does not modify the student record when it throws (transcript guard)", async () => {
    const student = await students.create({
      matricNumber: "KEEP-ME",
      fullName: "Hank",
      status: "ACTIVE",
      facultyId: "facA",
      admissionSession: "2025/2026",
      programmeId: "progA",
      levelId: "lvl1",
    });
    transcripts.issuedCounts.set(student.id, 3);

    await expect(regen({ studentId: student.id })).rejects.toBeInstanceOf(
      RecordsError,
    );

    // Matricule must be unchanged
    const unchanged = await students.findById(student.id);
    expect(unchanged?.matricNumber).toBe("KEEP-ME");
  });
});
