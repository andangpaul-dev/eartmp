import { describe, it, expect, beforeEach } from "vitest";
import {
  EvaluateGraduation,
  GraduateStudent,
  type SummaryProvider,
  type RequirementsProvider,
} from "../../src/application/use-cases/graduation/Graduation";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { RecordsError } from "../../src/domain/errors/records";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { CapturingAudit } from "../auth/fakes";
import { FakeStudentRepo } from "../records/fakes";
import type { GraduationSummary } from "../../src/domain/services/GraduationEligibility";

const reader = SessionContext.create("a", "ADMIN", ["graduation.read"]);
const clearer = SessionContext.create("a", "ADMIN", ["graduation.clear"]);

const reqs: RequirementsProvider = {
  async loadRequirements() {
    return {
      minCgpa: 2.0,
      minCreditsEarned: 120,
      requireNoOutstandingFails: true,
    };
  },
};
function summaryOf(s: GraduationSummary): SummaryProvider {
  return {
    async execute() {
      return s;
    },
  };
}

describe("EvaluateGraduation", () => {
  it("returns an eligible report for a passing student", async () => {
    const uc = new EvaluateGraduation(
      summaryOf({ cgpa: 3.5, creditsEarned: 120, creditsAttempted: 120 }),
      reqs,
    );
    expect((await uc.execute({ studentId: "s1" }, reader)).eligible).toBe(true);
  });

  it("is denied without graduation.read", async () => {
    const viewer = SessionContext.create("v", "VIEWER", ["results.read"]);
    await expect(
      authorize(
        new EvaluateGraduation(
          summaryOf({ cgpa: 3, creditsEarned: 120, creditsAttempted: 120 }),
          reqs,
        ),
        { studentId: "s1" },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("GraduateStudent", () => {
  let students: FakeStudentRepo;
  let audit: CapturingAudit;
  let studentId: string;
  beforeEach(async () => {
    students = new FakeStudentRepo();
    audit = new CapturingAudit();
    const s = await students.create({
      matricNumber: "M/1",
      fullName: "Ada",
      status: "ACTIVE",
    });
    studentId = s.id;
  });

  it("graduates an eligible ACTIVE student and audits", async () => {
    const uc = new GraduateStudent(
      summaryOf({ cgpa: 3.5, creditsEarned: 120, creditsAttempted: 120 }),
      reqs,
      students,
      audit,
    );
    const out = await uc.execute({ studentId }, clearer);
    expect(out.status).toBe("GRADUATED");
    expect((await students.findById(studentId))?.status).toBe("GRADUATED");
    expect(audit.entries.at(-1)).toMatchObject({ action: "GRADUATE" });
  });

  it("rejects an ineligible student (named reason)", async () => {
    const uc = new GraduateStudent(
      summaryOf({ cgpa: 1.0, creditsEarned: 90, creditsAttempted: 95 }),
      reqs,
      students,
      audit,
    );
    await expect(uc.execute({ studentId }, clearer)).rejects.toThrow(
      /not eligible/,
    );
    expect((await students.findById(studentId))?.status).toBe("ACTIVE");
  });

  it("rejects when the status transition isn't allowed (already GRADUATED)", async () => {
    await students.update(studentId, { status: "GRADUATED" });
    const uc = new GraduateStudent(
      summaryOf({ cgpa: 3.5, creditsEarned: 120, creditsAttempted: 120 }),
      reqs,
      students,
      audit,
    );
    await expect(uc.execute({ studentId }, clearer)).rejects.toBeInstanceOf(
      RecordsError,
    );
  });
});
