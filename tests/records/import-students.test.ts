import { describe, it, expect, beforeEach } from "vitest";
import { ImportStudents } from "../../src/application/use-cases/records/ImportStudents";
import type {
  GenerateMatricule,
  MatriculeSettingsPort,
  MatriculeContext,
  MatriculeMode,
} from "../../src/application/services/GenerateMatricule";
import type { TransactionalRepos as _TR } from "../../src/application/ports/UnitOfWork";
import type { FacultyByCode } from "../../src/application/use-cases/records/ImportStudents";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { fakeUow } from "../results/fakes";
import type { RawRow } from "../../src/application/ports/SpreadsheetReaderPort";
import { FakeStudentRepo } from "./fakes";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "students.create",
]);

let students: FakeStudentRepo;
let uc: ImportStudents;
beforeEach(() => {
  students = new FakeStudentRepo();
  uc = new ImportStudents(fakeUow({ students }));
});

// --- helpers for the generate-matricule tests ---

/** Tracks how many times .generate() was called in "reserve" mode. */
let reserveCallCount = 0;
let genSeq = 0;

const fakeGenerate: GenerateMatricule = {
  async generate(ctx: MatriculeContext, _repos: _TR, mode: MatriculeMode) {
    if (mode === "reserve") {
      reserveCallCount++;
      genSeq++;
      const yr = ctx.admissionSession.match(/(\d{4})/)?.[1]?.slice(-2) ?? "25";
      return `FS${yr}-${String(genSeq).padStart(4, "0")}`;
    }
    return "PEEK-0001";
  },
} as unknown as GenerateMatricule;

const fakeSettings: MatriculeSettingsPort = {
  async matriculeRule() {
    return "{faculty}{year2}-{seq:0000}";
  },
  async matriculeCheckScheme() {
    return "none" as import("../../src/domain/services/MatriculeCheck").CheckScheme;
  },
  async matriculeFormat() {
    return "";
  },
};

// Faculty lookup: "ENG" → "facA", "SCI" → "facA", "ART" → "facB", others → null
const fakeFacultyByCode: FacultyByCode = {
  async findByCode(code: string) {
    const map: Record<string, string> = {
      ENG: "facA",
      SCI: "facA",
      ART: "facB",
    };
    const id = map[code];
    return id ? { id } : null;
  },
};

/** Constructs an ImportStudents with full generate wiring. */
function makeUcWithGenerate() {
  const studentRepo = new FakeStudentRepo();
  const uow = fakeUow({ students: studentRepo });
  const ucFull = new ImportStudents(
    uow,
    fakeGenerate,
    fakeSettings,
    fakeFacultyByCode,
  );
  return { ucFull, studentRepo };
}

async function importRows(
  rows: RawRow[],
  opts: {
    facultyId: string;
    admissionSession: string;
    sessionFacultyIds?: string[];
  },
) {
  reserveCallCount = 0;
  genSeq = 0;
  const { ucFull } = makeUcWithGenerate();
  const sess = SessionContext.create(
    "officer",
    "OFFICER",
    ["students.create"],
    undefined,
    opts.sessionFacultyIds ?? [opts.facultyId],
  );
  return ucFull.execute(
    {
      rows,
      facultyId: opts.facultyId,
      admissionSession: opts.admissionSession,
    },
    sess,
  );
}

describe("ImportStudents", () => {
  it("imports a clean batch with the chosen placement", async () => {
    const report = await uc.execute(
      {
        rows: [
          { matricNumber: "M/1", fullName: "Ada", regNumber: "R1" },
          { matricNumber: "M/2", fullName: "Bo" },
        ],
        facultyId: "f1",
        departmentId: "d1",
        subDepartmentId: "sd1",
        admissionSession: "24/25",
      },
      admin,
    );
    expect(report.imported).toBe(2);
    expect(report.errors).toHaveLength(0);
    const ada = (await students.find({})).items.find(
      (s) => s.matricNumber === "M/1",
    )!;
    expect(ada.departmentId).toBe("d1");
    expect(ada.subDepartmentId).toBe("sd1");
    expect(ada.admissionSession).toBe("24/25");
    expect(ada.status).toBe("ACTIVE");
  });

  it("is all-or-nothing: a missing name means nothing is written", async () => {
    const report = await uc.execute(
      {
        rows: [
          { matricNumber: "M/1", fullName: "Ada" },
          { matricNumber: "M/2", fullName: "" }, // missing name
        ],
        facultyId: "f1",
      },
      admin,
    );
    expect(report.imported).toBe(0);
    expect(report.errors[0]).toMatchObject({ row: 2 });
    expect((await students.find({})).total).toBe(0);
  });

  it("flags in-file duplicates and existing matric numbers", async () => {
    await students.create({
      matricNumber: "M/9",
      fullName: "Existing",
      status: "ACTIVE",
    });
    const report = await uc.execute(
      {
        rows: [
          { matricNumber: "M/1", fullName: "A" },
          { matricNumber: "M/1", fullName: "B" }, // duplicate in file
          { matricNumber: "M/9", fullName: "C" }, // already exists
        ],
      },
      admin,
    );
    expect(report.imported).toBe(0);
    expect(report.errors.map((e) => e.row).sort()).toEqual([2, 3]);
    expect(report.errors.find((e) => e.row === 2)!.messages.join()).toMatch(
      /Duplicate/,
    );
    expect(report.errors.find((e) => e.row === 3)!.messages.join()).toMatch(
      /already exists/,
    );
  });

  it("dry run validates and reports without writing", async () => {
    const report = await uc.execute(
      {
        rows: [{ matricNumber: "M/1", fullName: "Ada" }],
        dryRun: true,
      },
      admin,
    );
    expect(report.validRows).toBe(1);
    expect(report.imported).toBe(0);
    expect((await students.find({})).total).toBe(0);
  });

  it("accepts alternate header names (matric / name)", async () => {
    const report = await uc.execute(
      { rows: [{ matric: "M/7", name: "Grace" }] },
      admin,
    );
    expect(report.imported).toBe(1);
  });

  it("is denied through the seam without students.create", async () => {
    const viewer = SessionContext.create("v", "VIEWER", ["students.read"]);
    await expect(authorize(uc, { rows: [] }, viewer)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  // --- auto-generate + per-row session/faculty tests ---

  it("generates matricules for rows that omit one; uses provided ones otherwise", async () => {
    const rep = await importRows(
      [{ name: "A" }, { matric: "GIVEN1", name: "B" }],
      { facultyId: "facA", admissionSession: "2025/2026" },
    );
    expect(rep.imported).toBe(2);
    expect(rep.errors).toHaveLength(0);
    // one reserve call for row 1; row 2 used the provided matric
    expect(reserveCallCount).toBe(1);
  });

  it("rolls back the counter when the batch fails validation", async () => {
    await importRows(
      [{ name: "A" }, { name: "" /* invalid: missing name */ }],
      { facultyId: "facA", admissionSession: "2025/2026" },
    );
    // errors > 0 → early return before the write loop; counter never reserved
    expect(reserveCallCount).toBe(0);
  });

  it("honors a per-row admissionSession override", async () => {
    const rep = await importRows(
      [{ name: "A", admissionSession: "2024/2025" }],
      { facultyId: "facA", admissionSession: "2025/2026" },
    );
    expect(rep.imported).toBe(1);
    expect(rep.errors).toHaveLength(0);
    // One generation call was made (with the per-row session 2024/2025)
    expect(reserveCallCount).toBe(1);
  });

  it("honors a per-row faculty (code) within scope; rejects an out-of-scope/unknown faculty as a row error", async () => {
    // "ART" resolves to "facB"; officer is scoped only to ["facA"] → row error
    const rep = await importRows([{ name: "A", faculty: "ART" }], {
      facultyId: "facA",
      admissionSession: "2025/2026",
    });
    expect(rep.imported).toBe(0);
    expect(rep.errors.length).toBeGreaterThan(0);
  });
});
