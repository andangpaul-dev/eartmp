/**
 * BulkRegenerateMatricules tests (Phase 8.1).
 *
 * - Happy path: regenerates facA students admitted in the target year,
 *   skipping those with issued transcripts.
 * - Year filter: students admitted in a different year are ignored.
 * - Faculty scope: a session bound to facA cannot target facB.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { BulkRegenerateMatricules } from "../../src/application/use-cases/records/BulkRegenerateMatricules";
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
      return `FS${String(ctx.admissionSession.match(/(\d{4})/)?.[1]).slice(-2)}-${String(reserveSeq).padStart(4, "0")}`;
    }
    return "PEEK";
  },
} as unknown as GenerateMatricule;

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** Global admin — unrestricted. */
const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "students.manage",
  "students.read",
]);

/** Faculty-A scoped officer. */
const facASession = SessionContext.create(
  "officer1",
  "FACULTY_ADMIN",
  ["students.manage", "students.read"],
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
  return new BulkRegenerateMatricules(makeUow(), fakeGenerate);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("BulkRegenerateMatricules", () => {
  it("regenerates in-scope students of the year, skipping those with transcripts", async () => {
    // Arrange: 3 facA students, all admitted in 2025/2026
    const s1 = await students.create({
      matricNumber: "OLD-0001",
      fullName: "Alice",
      status: "ACTIVE",
      facultyId: "facA",
      admissionSession: "2025/2026",
      programmeId: "progA",
      levelId: "lvl1",
    });
    const s2 = await students.create({
      matricNumber: "OLD-0002",
      fullName: "Bob",
      status: "ACTIVE",
      facultyId: "facA",
      admissionSession: "2025/2026",
      programmeId: "progA",
      levelId: "lvl1",
    });
    const s3 = await students.create({
      matricNumber: "OLD-0003",
      fullName: "Carol",
      status: "ACTIVE",
      facultyId: "facA",
      admissionSession: "2025/2026",
      programmeId: "progA",
      levelId: "lvl1",
    });

    // s3 has an issued transcript → should be skipped
    transcripts.issuedCounts.set(s3.id, 1);

    const report = await makeUc().execute(
      { facultyId: "facA", year: 2025 },
      admin,
    );

    expect(report.regenerated).toBe(2);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]).toBe(s3.matricNumber);

    // s1 and s2 should have been updated
    const updated1 = await students.findById(s1.id);
    const updated2 = await students.findById(s2.id);
    expect(updated1?.matricNumber).not.toBe("OLD-0001");
    expect(updated2?.matricNumber).not.toBe("OLD-0002");

    // s3 must remain unchanged
    const unchanged3 = await students.findById(s3.id);
    expect(unchanged3?.matricNumber).toBe("OLD-0003");
  });

  it("ignores students of a different admission year", async () => {
    // Arrange: a facA student admitted in 2024/2025 (year 2024)
    const s = await students.create({
      matricNumber: "OLD-2024",
      fullName: "Dave",
      status: "ACTIVE",
      facultyId: "facA",
      admissionSession: "2024/2025",
      programmeId: "progA",
      levelId: "lvl1",
    });

    // Act: target year 2025 — Dave's 2024/2025 session yields year 2024, should be ignored
    const report = await makeUc().execute(
      { facultyId: "facA", year: 2025 },
      admin,
    );

    expect(report.regenerated).toBe(0);
    expect(report.skipped).toHaveLength(0);

    // Matricule must be unchanged
    const unchanged = await students.findById(s.id);
    expect(unchanged?.matricNumber).toBe("OLD-2024");
  });

  it("is faculty-scoped: throws AuthorizationError when targeting another faculty", async () => {
    // facASession is scoped to facA; targeting facB must be refused up-front
    await expect(
      makeUc().execute({ facultyId: "facB", year: 2025 }, facASession),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
