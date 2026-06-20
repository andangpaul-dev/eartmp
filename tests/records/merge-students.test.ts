/**
 * TDD tests for MergeStudents + FindDuplicateCandidates (Workstream C Phase 7).
 *
 * MergeStudents:
 *   - re-points results/transcripts/enrollments from duplicateId → survivingId
 *   - soft-deletes the duplicate
 *   - audits the merge
 *   - refuses on conflicting results (same courseId+semesterId+sitting on both)
 *   - enforces institution + faculty scope on BOTH records
 *
 * FindDuplicateCandidates:
 *   - surfaces previousStudentId links
 *   - surfaces exact full-name matches
 *   - deduplicates pairs by unordered id set
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  MergeStudents,
  FindDuplicateCandidates,
} from "../../src/application/use-cases/records/MergeStudents";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { RecordsError } from "../../src/domain/errors/records";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { CapturingAudit } from "../auth/fakes";
import { FakeResultRepo, FakeTranscriptStore, fakeUow } from "../results/fakes";
import type { Student } from "../../src/domain/entities";
import type { TransactionalRepos } from "../../src/application/ports/UnitOfWork";
import { FakeStudentRepo, FakeEnrollmentRepo } from "./fakes";

// ── helpers ─────────────────────────────────────────────────────────────────

const PERM_MANAGE = ["students.manage"];
const PERM_READ = ["students.read"];

const adminSession = SessionContext.create("admin", "SUPER_ADMIN", [
  ...PERM_MANAGE,
  ...PERM_READ,
]);

/** A session scoped to institution "instA" AND faculty "facA". */
const facASession = SessionContext.create(
  "facA-admin",
  "FAC_ADMIN",
  [...PERM_MANAGE, ...PERM_READ],
  "instA",
  ["facA"],
);

function makeStudent(
  id: string,
  overrides: Partial<Omit<Student, "id">> = {},
): Student {
  return {
    id,
    matricNumber: `M/${id}`,
    fullName: `Student ${id}`,
    status: "ACTIVE",
    institutionId: "instA",
    facultyId: "facA",
    ...overrides,
  };
}

// ── MergeStudents ────────────────────────────────────────────────────────────

describe("MergeStudents", () => {
  let students: FakeStudentRepo;
  let results: FakeResultRepo;
  let transcripts: FakeTranscriptStore;
  let enrollments: FakeEnrollmentRepo;
  let audit: CapturingAudit;

  // The merge use-case is constructed with a UnitOfWork; we'll build the uow
  // around the fakes on each test run.

  beforeEach(() => {
    students = new FakeStudentRepo();
    results = new FakeResultRepo();
    transcripts = new FakeTranscriptStore();
    enrollments = new FakeEnrollmentRepo();
    audit = new CapturingAudit();
  });

  /** Seed students directly into the fake's internal map (bypasses seq). */
  function seedStudent(s: Student): void {
    (students as unknown as { byId: Map<string, Student> }).byId.set(s.id, s);
  }

  function buildUow(overrides: Partial<TransactionalRepos> = {}) {
    return fakeUow({
      students,
      results,
      transcripts,
      enrollments,
      audit,
      ...overrides,
    });
  }

  function makeMerge(session = adminSession) {
    const uc = new MergeStudents(buildUow());
    return (input: { survivingId: string; duplicateId: string }) =>
      uc.execute(input, session);
  }

  // ── happy path ────────────────────────────────────────────────────────────

  it("re-points results/transcripts/enrollments and soft-deletes the duplicate", async () => {
    seedStudent(makeStudent("keep"));
    seedStudent(makeStudent("dup"));

    // Give the duplicate a result + enrollment + transcript
    results.rows.push({
      id: "r1",
      studentId: "dup",
      courseId: "c1",
      semesterId: "s1",
      componentScores: [],
      isLocked: false,
      sitting: "NORMAL",
      status: "GRADED",
    });
    transcripts.rows.push({ studentId: "dup" });
    await enrollments.create({
      studentId: "dup",
      programmeId: "p1",
      levelId: "l1",
      fromSession: "2024/2025",
      isCurrent: true,
    });

    const merge = makeMerge();
    const out = await merge({ survivingId: "keep", duplicateId: "dup" });

    expect(out).toEqual({ ok: true });

    // results re-pointed
    expect(results.rows[0]!.studentId).toBe("keep");
    // transcripts re-pointed
    expect(transcripts.rows[0]!.studentId).toBe("keep");
    // enrollments re-pointed
    expect(enrollments.rows[0]!.studentId).toBe("keep");
    // duplicate is soft-deleted
    expect(await students.findById("dup")).toBeNull();
    // survivor still accessible
    const survivor = await students.findById("keep");
    expect(survivor).not.toBeNull();
    expect(survivor!.matricNumber).toBe("M/keep");
  });

  it("audits the MERGE action", async () => {
    seedStudent(makeStudent("keep"));
    seedStudent(makeStudent("dup", { matricNumber: "M/dup-old" }));

    const merge = makeMerge();
    await merge({ survivingId: "keep", duplicateId: "dup" });

    const entry = audit.entries.find((e) => e.action === "MERGE");
    expect(entry).toBeDefined();
    expect(entry!.entity).toBe("Student");
    expect(entry!.recordId).toBe("keep");
    expect(entry!.oldValue).toMatchObject({ duplicateId: "dup" });
    expect(entry!.newValue).toMatchObject({ survivingId: "keep" });
  });

  it("refuses when survivingId === duplicateId", async () => {
    seedStudent(makeStudent("keep"));
    const merge = makeMerge();
    await expect(
      merge({ survivingId: "keep", duplicateId: "keep" }),
    ).rejects.toBeInstanceOf(RecordsError);
  });

  it("refuses when surviving student not found", async () => {
    seedStudent(makeStudent("dup"));
    const merge = makeMerge();
    await expect(
      merge({ survivingId: "missing", duplicateId: "dup" }),
    ).rejects.toBeInstanceOf(RecordsError);
  });

  it("refuses when duplicate student not found", async () => {
    seedStudent(makeStudent("keep"));
    const merge = makeMerge();
    await expect(
      merge({ survivingId: "keep", duplicateId: "missing" }),
    ).rejects.toBeInstanceOf(RecordsError);
  });

  // ── conflict check ────────────────────────────────────────────────────────

  it("refuses a conflicting merge (same course/semester/sitting on both)", async () => {
    seedStudent(makeStudent("keep"));
    seedStudent(makeStudent("dupConflict"));

    // Both keep and dupConflict have a result for the SAME (courseId, semesterId, sitting)
    results.rows.push({
      id: "rKeep1",
      studentId: "keep",
      courseId: "c1",
      semesterId: "s1",
      componentScores: [],
      isLocked: false,
      sitting: "NORMAL",
      status: "GRADED",
    });
    results.rows.push({
      id: "rDup1",
      studentId: "dupConflict",
      courseId: "c1",
      semesterId: "s1",
      componentScores: [],
      isLocked: false,
      sitting: "NORMAL",
      status: "GRADED",
    });

    const uc = new MergeStudents(buildUow());
    await expect(
      uc.execute(
        { survivingId: "keep", duplicateId: "dupConflict" },
        adminSession,
      ),
    ).rejects.toThrow(/conflict|merge/i);

    // No reassign or soft-delete should have occurred
    expect(results.rows.find((r) => r.id === "rDup1")!.studentId).toBe(
      "dupConflict",
    );
    expect(await students.findById("dupConflict")).not.toBeNull();
  });

  // ── scope enforcement ─────────────────────────────────────────────────────

  it("enforces faculty scope: survivor belongs to another faculty", async () => {
    seedStudent(makeStudent("facBStu", { facultyId: "facB" }));
    seedStudent(makeStudent("facAStu", { facultyId: "facA" }));

    // facASession can only see facA — survivor is facB → forbidden
    const uc = new MergeStudents(
      fakeUow({ students, results, transcripts, enrollments, audit }),
    );
    await expect(
      uc.execute(
        { survivingId: "facBStu", duplicateId: "facAStu" },
        facASession,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("enforces faculty scope: duplicate belongs to another faculty", async () => {
    seedStudent(makeStudent("facAStu", { facultyId: "facA" }));
    seedStudent(makeStudent("facBStu", { facultyId: "facB" }));

    // facASession can see facA survivor, but facB duplicate → forbidden
    const uc = new MergeStudents(
      fakeUow({ students, results, transcripts, enrollments, audit }),
    );
    await expect(
      uc.execute(
        { survivingId: "facAStu", duplicateId: "facBStu" },
        facASession,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("requires students.manage permission", async () => {
    seedStudent(makeStudent("keep"));
    seedStudent(makeStudent("dup"));
    const noPerms = SessionContext.create("x", "VIEWER", ["students.read"]);
    await expect(
      authorize(
        new MergeStudents(buildUow()),
        { survivingId: "keep", duplicateId: "dup" },
        noPerms,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

// ── FindDuplicateCandidates ──────────────────────────────────────────────────

describe("FindDuplicateCandidates", () => {
  let students: FakeStudentRepo;

  beforeEach(() => {
    students = new FakeStudentRepo();
  });

  function seedStudent(s: Student): void {
    (students as unknown as { byId: Map<string, Student> }).byId.set(s.id, s);
  }

  function makeFindCandidates(session = adminSession) {
    const uc = new FindDuplicateCandidates(students);
    return (input: Record<string, never> = {}) =>
      uc.execute(input as never, session);
  }

  it("surfaces previousStudentId links", async () => {
    seedStudent(makeStudent("original", { fullName: "Alice" }));
    seedStudent(
      makeStudent("alias", {
        fullName: "Alice Alias",
        previousStudentId: "original",
      }),
    );

    const pairs = await makeFindCandidates()();
    const link = pairs.find((p) => p.reason === "previousStudentId link");
    expect(link).toBeDefined();
    expect(link!.survivingId).toBe("original");
    expect(link!.duplicateId).toBe("alias");
  });

  it("surfaces exact name matches", async () => {
    seedStudent(makeStudent("s1", { fullName: "John Doe" }));
    seedStudent(makeStudent("s2", { fullName: "John Doe" }));

    const pairs = await makeFindCandidates()();
    const match = pairs.find((p) => p.reason === "exact name match");
    expect(match).toBeDefined();
    // The one with lower id = survivingId (older = first created)
    expect(match!.survivingId).toBe("s1");
    expect(match!.duplicateId).toBe("s2");
  });

  it("deduplicates pairs already emitted by previousStudentId link (no double-pair)", async () => {
    // s1 is the original, s2 points back to s1 AND they have the same name
    seedStudent(makeStudent("s1", { fullName: "John Doe" }));
    seedStudent(
      makeStudent("s2", {
        fullName: "John Doe",
        previousStudentId: "s1",
      }),
    );

    const pairs = await makeFindCandidates()();
    // The (s1, s2) pair should appear exactly once (not twice)
    const relevant = pairs.filter(
      (p) =>
        (p.survivingId === "s1" && p.duplicateId === "s2") ||
        (p.survivingId === "s2" && p.duplicateId === "s1"),
    );
    expect(relevant).toHaveLength(1);
  });

  it("returns empty array when no duplicates exist", async () => {
    seedStudent(makeStudent("a", { fullName: "Alice" }));
    seedStudent(makeStudent("b", { fullName: "Bob" }));

    const pairs = await makeFindCandidates()();
    expect(pairs).toHaveLength(0);
  });

  it("emits multiple pairs for a group of 3 name-clones", async () => {
    seedStudent(makeStudent("s1", { fullName: "Clone" }));
    seedStudent(makeStudent("s2", { fullName: "Clone" }));
    seedStudent(makeStudent("s3", { fullName: "Clone" }));

    const pairs = await makeFindCandidates()();
    // Expect 3 pairs: (s1,s2), (s1,s3), (s2,s3)
    expect(pairs.length).toBeGreaterThanOrEqual(3);
  });

  it("ignores previousStudentId links that point at deleted (non-live) students", async () => {
    // Only "alive" is seeded; "ghost" is NOT in the live set (already merged/deleted)
    seedStudent(makeStudent("alive", { previousStudentId: "ghost" }));

    const pairs = await makeFindCandidates()();
    // No link candidate — the target doesn't exist in the live set
    const link = pairs.find((p) => p.reason === "previousStudentId link");
    expect(link).toBeUndefined();
  });

  it("requires students.read permission", async () => {
    const noPerms = SessionContext.create("x", "VIEWER", []);
    await expect(
      authorize(new FindDuplicateCandidates(students), {}, noPerms),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
