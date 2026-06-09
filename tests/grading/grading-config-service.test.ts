import { describe, it, expect } from "vitest";
import { GradingConfigService } from "../../src/application/services/GradingConfigService";
import { GradeScaleError } from "../../src/domain/value-objects/GradeScale";
import { AssessmentError } from "../../src/domain/value-objects/AssessmentStructure";
import { GpaEngine } from "../../src/domain/services/GpaEngine";
import {
  buildDefaultRegistry,
  SETTING_KEYS,
} from "../../src/domain/settings/SettingsRegistry";
import { InMemorySettingRepository } from "../config/fakes";
import type {
  GradeScaleConfigRepository,
  AssessmentConfigRepository,
  StoredGradeScale,
  StoredAssessmentConfig,
} from "../../src/domain/repositories/grading";

const validBands = JSON.stringify([
  { minMark: 0, maxMark: 49, grade: "F", gradePoint: 0, isPass: false },
  { minMark: 50, maxMark: 100, grade: "P", gradePoint: 4, isPass: true },
]);
const gappedBands = JSON.stringify([
  { minMark: 0, maxMark: 40, grade: "F", gradePoint: 0, isPass: false },
  { minMark: 50, maxMark: 100, grade: "P", gradePoint: 4, isPass: true },
]);
const validComponents = JSON.stringify([
  { key: "ca", label: "CA", weight: 30, maxScore: 30 },
  { key: "exam", label: "Exam", weight: 70, maxScore: 70 },
]);
const badComponents = JSON.stringify([
  { key: "ca", label: "CA", weight: 40, maxScore: 100 },
  { key: "exam", label: "Exam", weight: 70, maxScore: 100 },
]);

class FakeGradeScaleRepo implements GradeScaleConfigRepository {
  constructor(private rows: StoredGradeScale[]) {}
  async findDefault() {
    return this.rows.find((r) => r.isDefault) ?? null;
  }
  async findById(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async findByName(name: string) {
    return this.rows.find((r) => r.name === name) ?? null;
  }
}
class FakeAssessmentRepo implements AssessmentConfigRepository {
  constructor(private rows: StoredAssessmentConfig[]) {}
  async findDefault() {
    return this.rows.find((r) => r.isDefault) ?? null;
  }
  async findByName(name: string) {
    return this.rows.find((r) => r.name === name) ?? null;
  }
}

function service(opts: {
  scales?: StoredGradeScale[];
  assessments?: StoredAssessmentConfig[];
  settings?: Record<string, string>;
}) {
  return new GradingConfigService(
    new FakeGradeScaleRepo(opts.scales ?? []),
    new FakeAssessmentRepo(opts.assessments ?? []),
    new InMemorySettingRepository(opts.settings ?? {}),
    buildDefaultRegistry(),
  );
}

describe("GradingConfigService.loadGradeScale", () => {
  it("loads and validates the default scale", async () => {
    const svc = service({
      scales: [{ id: "g1", name: "Std", bands: validBands, isDefault: true }],
    });
    const scale = await svc.loadGradeScale();
    expect(scale.resolve(75).grade).toBe("P");
  });

  it("resolves by id and by name", async () => {
    const svc = service({
      scales: [
        { id: "g1", name: "Std", bands: validBands, isDefault: false },
        { id: "g2", name: "Other", bands: validBands, isDefault: true },
      ],
    });
    expect((await svc.loadGradeScale({ id: "g1" })).toBands()).toHaveLength(2);
    expect((await svc.loadGradeScale({ name: "Std" })).toBands()).toHaveLength(
      2,
    );
  });

  it("throws when no scale is configured", async () => {
    await expect(service({}).loadGradeScale()).rejects.toBeInstanceOf(
      GradeScaleError,
    );
  });

  it("fails loudly when stored bands are invalid (gap)", async () => {
    const svc = service({
      scales: [{ id: "g1", name: "Bad", bands: gappedBands, isDefault: true }],
    });
    await expect(svc.loadGradeScale()).rejects.toBeInstanceOf(GradeScaleError);
  });

  it("fails loudly when stored bands are corrupt JSON", async () => {
    const svc = service({
      scales: [{ id: "g1", name: "Bad", bands: "{not json", isDefault: true }],
    });
    await expect(svc.loadGradeScale()).rejects.toThrow(/corrupt/);
  });
});

describe("GradingConfigService.loadAssessmentStructure", () => {
  it("loads and validates the default structure", async () => {
    const svc = service({
      assessments: [
        { id: "a1", name: "Std", components: validComponents, isDefault: true },
      ],
    });
    const a = await svc.loadAssessmentStructure();
    expect(
      a.computeFinalScore([
        { key: "ca", score: 30 },
        { key: "exam", score: 70 },
      ]),
    ).toBe(100);
  });

  it("fails loudly when weights do not sum to 100", async () => {
    const svc = service({
      assessments: [
        { id: "a1", name: "Bad", components: badComponents, isDefault: true },
      ],
    });
    await expect(svc.loadAssessmentStructure()).rejects.toBeInstanceOf(
      AssessmentError,
    );
  });

  it("throws when none is configured", async () => {
    await expect(service({}).loadAssessmentStructure()).rejects.toBeInstanceOf(
      AssessmentError,
    );
  });
});

describe("GradingConfigService.loadStandingBands", () => {
  it("returns the registry default when unset and classifies correctly", async () => {
    const bands = await service({}).loadStandingBands();
    expect(GpaEngine.resolveStanding(3.8, bands)).toBe("First Class");
    expect(GpaEngine.resolveStanding(0.4, bands)).toBe("Fail");
  });

  it("returns stored bands when set", async () => {
    const registry = buildDefaultRegistry();
    const raw = registry.serialize(SETTING_KEYS.standingBands, [
      { label: "Distinction", minGpa: 3.5 },
      { label: "Ordinary", minGpa: 0 },
    ]);
    const bands = await service({
      settings: { [SETTING_KEYS.standingBands]: raw },
    }).loadStandingBands();
    expect(GpaEngine.resolveStanding(3.9, bands)).toBe("Distinction");
    expect(GpaEngine.resolveStanding(1.0, bands)).toBe("Ordinary");
  });
});
