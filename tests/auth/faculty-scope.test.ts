/**
 * Faculty-scoped RBAC (workstream A): the scope helpers, SetUserFaculties, and
 * the results-entry faculty guard. A user with assigned faculties may only
 * see/touch those faculties' data; an unassigned user is institution-wide.
 */
import { describe, it, expect } from "vitest";
import {
  scopeStudentWhere,
  assertInFacultyScope,
  requireInFacultyScope,
} from "../../src/application/authorization/institutionScope";
import { SetUserFaculties } from "../../src/application/use-cases/auth/ManageUsers";
import { EnterResult } from "../../src/application/use-cases/results/ManageResults";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { ValidationError } from "../../src/domain/errors/validation";
import type { UserAccount } from "../../src/domain/entities/auth";
import { InMemoryUserRepository } from "./fakes";
import { CapturingAudit } from "./fakes";

const unscoped = SessionContext.create("reg", "REGISTRAR", ["results.process"]);
const facA = SessionContext.create(
  "fo",
  "FACULTY_OFFICER",
  ["results.process"],
  "inst1",
  ["facA"],
);

describe("scope helpers", () => {
  it("scopeStudentWhere adds a faculty filter only when scoped", () => {
    // Unscoped (global) → unchanged.
    expect(scopeStudentWhere({ status: "ACTIVE" } as never, unscoped)).toEqual({
      status: "ACTIVE",
    });
    // Faculty-scoped → institution + facultyId IN.
    expect(scopeStudentWhere(undefined, facA)).toEqual({
      institutionId: "inst1",
      facultyId: { in: ["facA"] },
    });
  });

  it("assert/requireInFacultyScope gate by the assigned set", () => {
    expect(assertInFacultyScope("facA", facA)).toBe(true);
    expect(assertInFacultyScope("facB", facA)).toBe(false);
    expect(assertInFacultyScope("anything", unscoped)).toBe(true); // unscoped
    expect(() => requireInFacultyScope("facB", facA)).toThrow(
      AuthorizationError,
    );
    expect(() => requireInFacultyScope("facA", facA)).not.toThrow();
  });
});

describe("SetUserFaculties", () => {
  const target: UserAccount = {
    id: "u1",
    username: "x",
    email: "x@e.edu",
    fullName: "X",
    passwordHash: "h",
    roleId: "r",
    institutionId: "inst1",
    isActive: true,
  } as UserAccount;

  const faculties = {
    async findById(id: string) {
      return id === "facA" || id === "facB"
        ? { id, name: id, code: id, institutionId: "inst1" }
        : null;
    },
  } as never;

  it("replaces a user's faculty set", async () => {
    const users = new InMemoryUserRepository([target]);
    const admin = SessionContext.create("a", "SUPER_ADMIN", ["users.update"]);
    await new SetUserFaculties(users, faculties, new CapturingAudit()).execute(
      { userId: "u1", facultyIds: ["facA", "facB"] },
      admin,
    );
    expect(await users.facultyIds("u1")).toEqual(["facA", "facB"]);
  });

  it("rejects an unknown faculty", async () => {
    const users = new InMemoryUserRepository([target]);
    const admin = SessionContext.create("a", "SUPER_ADMIN", ["users.update"]);
    await expect(
      new SetUserFaculties(users, faculties, new CapturingAudit()).execute(
        { userId: "u1", facultyIds: ["nope"] },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("EnterResult faculty guard (host-wired student repo)", () => {
  const students = {
    async findById(id: string) {
      return id === "sA"
        ? { id, facultyId: "facA", institutionId: "inst1" }
        : id === "sB"
          ? { id, facultyId: "facB", institutionId: "inst1" }
          : null;
    },
  } as never;
  const results = {
    async findByStudentAndSemester() {
      return [];
    },
    async create(d: unknown) {
      return { id: "r1", ...(d as object) } as never;
    },
  } as never;
  const grading = {
    async loadAssessmentStructure() {
      return { computeFinalScore: () => 70 } as never;
    },
  } as never;

  it("blocks a faculty-scoped officer from entering another faculty's result", async () => {
    const uc = new EnterResult(
      results,
      grading,
      new CapturingAudit(),
      students,
    );
    await expect(
      uc.execute(
        {
          studentId: "sB",
          courseId: "c",
          semesterId: "s",
          componentScores: [],
        },
        facA,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("allows entering a result for a student in an assigned faculty", async () => {
    const uc = new EnterResult(
      results,
      grading,
      new CapturingAudit(),
      students,
    );
    const r = await uc.execute(
      { studentId: "sA", courseId: "c", semesterId: "s", componentScores: [] },
      facA,
    );
    expect(r).toBeTruthy();
  });
});
