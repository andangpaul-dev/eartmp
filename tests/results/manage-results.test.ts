import { describe, it, expect, beforeEach, vi } from "vitest";
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

const adminWithOverride = SessionContext.create("admin", "SUPER_ADMIN", [
  "results.read",
  "results.process",
  "results.unlock",
  "results.override",
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

  it("creates a RESIT row distinct from the NORMAL row", async () => {
    const uc = new EnterResult(results, await makeGrading(), audit);
    // First create the NORMAL row
    await uc.execute(
      {
        studentId: "s",
        courseId: "c",
        semesterId: "sem",
        componentScores: [
          { key: "ca", score: 10 },
          { key: "exam", score: 30 },
        ],
      },
      admin,
    );
    // Now create a RESIT row — must be a separate row
    const createSpy = vi.spyOn(results, "create");
    await uc.execute(
      {
        studentId: "s",
        courseId: "c",
        semesterId: "sem",
        sitting: "RESIT",
        componentScores: [
          { key: "ca", score: 20 },
          { key: "exam", score: 50 },
        ],
      },
      admin,
    );
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sitting: "RESIT", status: "GRADED" }),
    );
    expect(results.rows).toHaveLength(2);
  });

  it("records a DID with no scores", async () => {
    const uc = new EnterResult(results, await makeGrading(), audit);
    const createSpy = vi.spyOn(results, "create");
    await uc.execute(
      {
        studentId: "s",
        courseId: "c",
        semesterId: "sem",
        status: "DID",
        componentScores: [],
      },
      admin,
    );
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "DID" }),
    );
    // finalScore should be absent (DID is not GRADED)
    const created = results.rows[0]!;
    expect(created.finalScore).toBeUndefined();
  });

  it("refuses to edit a locked row without override", async () => {
    const uc = new EnterResult(results, await makeGrading(), audit);
    // Seed a locked NORMAL row
    await results.create({
      studentId: "s",
      courseId: "c",
      semesterId: "sem",
      componentScores: [],
      finalScore: 50,
      isLocked: true,
      sitting: "NORMAL",
      status: "GRADED",
    });
    await expect(
      uc.execute(
        {
          studentId: "s",
          courseId: "c",
          semesterId: "sem",
          componentScores: [
            { key: "ca", score: 20 },
            { key: "exam", score: 50 },
          ],
        },
        admin,
      ),
    ).rejects.toThrow(/locked/i);
  });

  it("edits a locked row WITH override, audited as override", async () => {
    const uc = new EnterResult(results, await makeGrading(), audit);
    // Seed a locked NORMAL row
    await results.create({
      studentId: "s",
      courseId: "c",
      semesterId: "sem",
      componentScores: [],
      finalScore: 50,
      isLocked: true,
      sitting: "NORMAL",
      status: "GRADED",
    });
    await uc.execute(
      {
        studentId: "s",
        courseId: "c",
        semesterId: "sem",
        componentScores: [
          { key: "ca", score: 20 },
          { key: "exam", score: 50 },
        ],
      },
      adminWithOverride,
    );
    const lastEntry = audit.entries.at(-1)!;
    expect(lastEntry.action).toBe("UPDATE");
    expect(lastEntry.newValue).toMatchObject({ override: true });
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
      sitting: "NORMAL",
      status: "GRADED",
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

  it("locks only the named sitting", async () => {
    const spy = vi.spyOn(results, "setLockedForSemester");
    await new LockSemesterResults(results, audit).execute(
      { studentId: "s", semesterId: "sem", sitting: "NORMAL" },
      admin,
    );
    expect(spy).toHaveBeenCalledWith("s", "sem", true, "NORMAL");
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
      sitting: "NORMAL",
      status: "GRADED",
    });
    const rows = await new GetStudentSemesterResults(results).execute(
      { studentId: "s1", semesterId: "sem1" },
      admin,
    );
    expect(rows).toHaveLength(1);
  });
});
