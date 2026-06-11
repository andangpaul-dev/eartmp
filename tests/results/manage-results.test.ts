import { describe, it, expect, beforeEach } from "vitest";
import {
  EnterResult,
  LockSemesterResults,
  UnlockResult,
  GetStudentSemesterResults,
} from "../../src/application/use-cases/results/ManageResults";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { GradingConfigService } from "../../src/application/services/GradingConfigService";
import { buildDefaultRegistry } from "../../src/domain/settings/SettingsRegistry";
import { RecordsError } from "../../src/domain/errors/records";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { CapturingAudit } from "../auth/fakes";
import {
  FakeGradeScaleRepo,
  FakeAssessmentConfigRepo,
} from "../config/grading-fakes";
import { InMemorySettingRepository } from "../config/fakes";
import { FakeResultRepo } from "./fakes";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "results.read",
  "results.process",
  "results.unlock",
]);

async function makeGrading() {
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

let results: FakeResultRepo;
let audit: CapturingAudit;
beforeEach(() => {
  results = new FakeResultRepo();
  audit = new CapturingAudit();
});

describe("EnterResult", () => {
  it("computes the final score from components and creates the result", async () => {
    const uc = new EnterResult(results, await makeGrading(), audit);
    const r = await uc.execute(
      {
        studentId: "s1",
        courseId: "c1",
        semesterId: "sem1",
        componentScores: [
          { key: "ca", score: 28 },
          { key: "exam", score: 65 },
        ],
      },
      admin,
    );
    expect(r.finalScore).toBe(93); // 28 + 65
    expect(audit.entries[0]).toMatchObject({
      action: "CREATE",
      entity: "Result",
    });
  });

  it("dedupes: re-entering updates the same result, not a duplicate", async () => {
    const uc = new EnterResult(results, await makeGrading(), audit);
    const base = {
      studentId: "s1",
      courseId: "c1",
      semesterId: "sem1",
    };
    await uc.execute(
      {
        ...base,
        componentScores: [
          { key: "ca", score: 10 },
          { key: "exam", score: 10 },
        ],
      },
      admin,
    );
    await uc.execute(
      {
        ...base,
        componentScores: [
          { key: "ca", score: 30 },
          { key: "exam", score: 70 },
        ],
      },
      admin,
    );
    expect(results.rows).toHaveLength(1);
    expect(results.rows[0]!.finalScore).toBe(100);
  });

  it("rejects editing a locked result", async () => {
    const grading = await makeGrading();
    const uc = new EnterResult(results, grading, audit);
    const base = { studentId: "s1", courseId: "c1", semesterId: "sem1" };
    await uc.execute(
      {
        ...base,
        componentScores: [
          { key: "ca", score: 10 },
          { key: "exam", score: 10 },
        ],
      },
      admin,
    );
    await results.setLockedForSemester("s1", "sem1", true);
    await expect(
      uc.execute(
        {
          ...base,
          componentScores: [
            { key: "ca", score: 30 },
            { key: "exam", score: 70 },
          ],
        },
        admin,
      ),
    ).rejects.toThrow(/locked/);
  });

  it("is denied without results.process", async () => {
    const viewer = SessionContext.create("v", "VIEWER", ["results.read"]);
    const uc = new EnterResult(results, await makeGrading(), audit);
    await expect(
      authorize(
        uc,
        {
          studentId: "s1",
          courseId: "c1",
          semesterId: "sem1",
          componentScores: [],
        },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("Lock / Unlock", () => {
  beforeEach(async () => {
    await results.create({
      studentId: "s1",
      courseId: "c1",
      semesterId: "sem1",
      componentScores: [],
      finalScore: 80,
      isLocked: false,
    });
  });

  it("locks a semester and audits", async () => {
    const n = await new LockSemesterResults(results, audit).execute(
      { studentId: "s1", semesterId: "sem1" },
      admin,
    );
    expect(n).toBe(1);
    expect(results.rows[0]!.isLocked).toBe(true);
    expect(audit.entries.at(-1)).toMatchObject({ action: "LOCK" });
  });

  it("unlocks a single result (audited); rejects unknown id", async () => {
    await new LockSemesterResults(results, audit).execute(
      { studentId: "s1", semesterId: "sem1" },
      admin,
    );
    const id = results.rows[0]!.id;
    await new UnlockResult(results, audit).execute({ resultId: id }, admin);
    expect(results.rows[0]!.isLocked).toBe(false);
    expect(audit.entries.at(-1)).toMatchObject({ action: "UNLOCK" });
    await expect(
      new UnlockResult(results, audit).execute({ resultId: "ghost" }, admin),
    ).rejects.toBeInstanceOf(RecordsError);
  });

  it("UnlockResult requires results.unlock", () => {
    const uc = new UnlockResult(results, audit);
    expect(uc.requiredPermissions).toEqual(["results.unlock"]);
  });
});

describe("GetStudentSemesterResults", () => {
  it("returns results for the student's semester", async () => {
    await results.create({
      studentId: "s1",
      courseId: "c1",
      semesterId: "sem1",
      componentScores: [],
      finalScore: 70,
      isLocked: false,
    });
    const rows = await new GetStudentSemesterResults(results).execute(
      { studentId: "s1", semesterId: "sem1" },
      admin,
    );
    expect(rows).toHaveLength(1);
  });
});
