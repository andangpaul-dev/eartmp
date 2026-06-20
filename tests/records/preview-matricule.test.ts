/**
 * PreviewMatricule tests (Phase 5 Workstream C).
 *
 * - Returns the "peek" matricule (does NOT consume the counter).
 * - Calling it twice must not advance the fake counter.
 * - Faculty-scope is enforced.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PreviewMatricule } from "../../src/application/use-cases/records/PreviewMatricule";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import type {
  GenerateMatricule,
  MatriculeContext,
  MatriculeMode,
} from "../../src/application/services/GenerateMatricule";
import type { TransactionalRepos } from "../../src/application/ports/UnitOfWork";
import { fakeUow } from "../results/fakes";
import { FakeStudentRepo } from "./fakes";

// A fake GenerateMatricule that tracks peek vs reserve calls.
let peekCount = 0;
let reserveCount = 0;

const fakeGenerate: GenerateMatricule = {
  async generate(
    ctx: MatriculeContext,
    _repos: TransactionalRepos,
    mode: MatriculeMode,
  ) {
    if (mode === "peek") {
      peekCount++;
      return `PEEK-${ctx.facultyId}-${ctx.admissionSession}`;
    }
    reserveCount++;
    return `RESERVE-${ctx.facultyId}`;
  },
} as unknown as GenerateMatricule;

const admin = SessionContext.create("admin", "SUPER_ADMIN", ["students.read"]);
const facultyScopedOfficer = SessionContext.create(
  "officer",
  "OFFICER",
  ["students.read"],
  undefined,
  ["facA"],
);

beforeEach(() => {
  peekCount = 0;
  reserveCount = 0;
});

function makeUow() {
  return fakeUow({ students: new FakeStudentRepo() });
}

describe("PreviewMatricule", () => {
  it("returns the peek matricule without reserving a sequence number", async () => {
    const uc = new PreviewMatricule(makeUow(), fakeGenerate);
    const result = await uc.execute(
      { facultyId: "facA", admissionSession: "2025/2026" },
      admin,
    );
    expect(result.matricule).toBe("PEEK-facA-2025/2026");
    expect(peekCount).toBe(1);
    expect(reserveCount).toBe(0);
  });

  it("calling it twice does NOT advance the fake counter", async () => {
    const uc = new PreviewMatricule(makeUow(), fakeGenerate);
    const first = await uc.execute(
      { facultyId: "facB", admissionSession: "2025/2026" },
      admin,
    );
    const second = await uc.execute(
      { facultyId: "facB", admissionSession: "2025/2026" },
      admin,
    );
    // Both calls should return the same value (counter not advanced).
    expect(first.matricule).toBe(second.matricule);
    expect(peekCount).toBe(2);
    expect(reserveCount).toBe(0);
  });

  it("faculty-scope enforced: officer may preview own faculty", async () => {
    const uc = new PreviewMatricule(makeUow(), fakeGenerate);
    const result = await uc.execute(
      { facultyId: "facA", admissionSession: "2025/2026" },
      facultyScopedOfficer,
    );
    expect(result.matricule).toContain("PEEK");
  });

  it("faculty-scope enforced: officer cannot preview a different faculty", async () => {
    const uc = new PreviewMatricule(makeUow(), fakeGenerate);
    await expect(
      uc.execute(
        { facultyId: "facZ", admissionSession: "2025/2026" },
        facultyScopedOfficer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
