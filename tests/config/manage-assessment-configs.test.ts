import { describe, it, expect, beforeEach } from "vitest";
import {
  CreateAssessmentConfig,
  DeleteAssessmentConfig,
  SetDefaultAssessmentConfig,
  ListAssessmentConfigs,
} from "../../src/application/use-cases/config/ManageAssessmentConfigs";
import { AssessmentError } from "../../src/domain/value-objects/AssessmentStructure";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { CapturingAudit } from "../auth/fakes";
import { FakeAssessmentConfigRepo } from "./grading-fakes";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "config.read",
  "config.manage",
]);

const validComponents = [
  { key: "ca", label: "CA", weight: 30, maxScore: 30 },
  { key: "exam", label: "Exam", weight: 70, maxScore: 70 },
];
const badComponents = [
  { key: "ca", label: "CA", weight: 40, maxScore: 100 },
  { key: "exam", label: "Exam", weight: 70, maxScore: 100 },
];

let configs: FakeAssessmentConfigRepo;
let audit: CapturingAudit;
beforeEach(() => {
  configs = new FakeAssessmentConfigRepo();
  audit = new CapturingAudit();
});

describe("CreateAssessmentConfig (write-side validation)", () => {
  it("creates a valid structure", async () => {
    const created = await new CreateAssessmentConfig(configs, audit).execute(
      { name: "CA+Exam", components: validComponents },
      admin,
    );
    expect(JSON.parse(created.components)).toHaveLength(2);
  });

  it("REJECTS components whose weights do not sum to 100", async () => {
    await expect(
      new CreateAssessmentConfig(configs, audit).execute(
        { name: "Bad", components: badComponents },
        admin,
      ),
    ).rejects.toBeInstanceOf(AssessmentError);
    expect(configs.byId.size).toBe(0);
  });
});

describe("default + delete guards", () => {
  it("single default; the default cannot be deleted", async () => {
    const create = new CreateAssessmentConfig(configs, audit);
    const a = await create.execute(
      { name: "A", components: validComponents },
      admin,
    );
    const b = await create.execute(
      { name: "B", components: validComponents },
      admin,
    );
    const setDefault = new SetDefaultAssessmentConfig(configs, audit);
    await setDefault.execute({ id: a.id }, admin);
    await setDefault.execute({ id: b.id }, admin);
    expect((await configs.findDefault())?.name).toBe("B");
    await expect(
      new DeleteAssessmentConfig(configs, audit).execute({ id: b.id }, admin),
    ).rejects.toThrow(/Cannot delete the default/);
    await new DeleteAssessmentConfig(configs, audit).execute(
      { id: a.id },
      admin,
    );
    expect(
      (await new ListAssessmentConfigs(configs).execute({}, admin)).map(
        (c) => c.name,
      ),
    ).toEqual(["B"]);
  });
});
