/**
 * Integration tests against a REAL throwaway SQLite database (migrated fresh).
 * Proves the persistence foundation end-to-end:
 *   - UnitOfWork commit persists; a throw rolls back ALL writes (F-1)
 *   - optimistic locking detects a stale version (F-27)
 *   - AdmitStudent commits student + enrollment together
 *
 * The temp DB is created + migrated in beforeAll and deleted in afterAll — never
 * the operator's dev.db.
 */
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaUnitOfWork } from "../../src/infrastructure/persistence/PrismaUnitOfWork";
import { PrismaStudentRepository } from "../../src/infrastructure/repositories/PrismaRecordsRepositories";
import { AdmitStudent } from "../../src/application/use-cases/records/AdmitStudent";
import { ConcurrencyError } from "../../src/domain/errors/persistence";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";

const TMP = `${process.cwd().replace(/\\/g, "/")}/.tmp-integration.db`;
const URL = `file:${TMP}`;
const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "students.create",
]);

let db: PrismaClient;
let progId: string;
let levelId: string;

beforeAll(async () => {
  for (const f of [TMP, `${TMP}-journal`]) if (existsSync(f)) rmSync(f);
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: URL },
    stdio: "pipe",
  });
  db = new PrismaClient({ datasourceUrl: URL });
  // Fixture for enrollment FK.
  const fac = await db.faculty.create({ data: { name: "F", code: "IT-F" } });
  const dep = await db.department.create({
    data: { name: "D", code: "IT-D", facultyId: fac.id },
  });
  const prog = await db.programme.create({
    data: { name: "P", code: "IT-P", departmentId: dep.id },
  });
  const lvl = await db.level.create({
    data: { name: "100", rank: 1, programmeId: prog.id },
  });
  progId = prog.id;
  levelId = lvl.id;
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  for (const f of [TMP, `${TMP}-journal`]) if (existsSync(f)) rmSync(f);
});

describe("UnitOfWork", () => {
  it("commits all writes on success", async () => {
    const uow = new PrismaUnitOfWork(db);
    await uow.run(async (repos) => {
      await repos.students.create({
        matricNumber: "OK/1",
        fullName: "Committed",
        status: "ACTIVE",
      });
    });
    expect(
      await db.student.findFirst({ where: { matricNumber: "OK/1" } }),
    ).not.toBeNull();
  });

  it("rolls back ALL writes when the work throws (F-1)", async () => {
    const uow = new PrismaUnitOfWork(db);
    await expect(
      uow.run(async (repos) => {
        await repos.students.create({
          matricNumber: "RB/1",
          fullName: "RolledBack",
          status: "ACTIVE",
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // The student write must NOT have persisted.
    expect(
      await db.student.findFirst({ where: { matricNumber: "RB/1" } }),
    ).toBeNull();
  });
});

describe("optimistic locking (F-27)", () => {
  it("rejects a stale-version update with ConcurrencyError", async () => {
    const repo = new PrismaStudentRepository(db);
    const s = await repo.create({
      matricNumber: "OL/1",
      fullName: "Versioned",
      status: "ACTIVE",
    });
    expect(await repo.readVersion(s.id)).toBe(0);

    const newVersion = await repo.tryUpdate(s.id, { status: "DEFERRED" }, 0);
    expect(newVersion).toBe(1);

    // A second writer holding the stale version 0 must be rejected.
    await expect(
      repo.tryUpdate(s.id, { status: "ACTIVE" }, 0),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });
});

describe("AdmitStudent (atomic across two tables)", () => {
  it("commits the student and the initial enrollment together", async () => {
    const uow = new PrismaUnitOfWork(db);
    const noopGenerate = {
      generate: async (): Promise<string> => {
        throw new Error("not used");
      },
    } as never;
    const noopSettings = {
      async matriculeRule() {
        return "";
      },
      async matriculeCheckScheme() {
        return "none" as never;
      },
      async matriculeFormat() {
        return "";
      },
    };
    const { student } = await new AdmitStudent(
      uow,
      noopGenerate,
      noopSettings,
    ).execute(
      {
        matricNumber: "AD/1",
        fullName: "Admitted",
        programmeId: progId,
        levelId,
        admissionSession: "24/25",
      },
      admin,
    );
    const enrollment = await db.studentEnrollment.findFirst({
      where: { studentId: student.id, isCurrent: true },
    });
    expect(enrollment?.programmeId).toBe(progId);
  });
});

describe("cross-institution placement validation (Phase E)", () => {
  it("rejects a student whose placement spans two institutions, resolves a clean one", async () => {
    const instA = await db.institution.create({ data: { name: "Inst A" } });
    const instB = await db.institution.create({ data: { name: "Inst B" } });
    const facA = await db.faculty.create({
      data: { name: "FA", code: "FA", institutionId: instA.id },
    });
    const depB = await db.department.create({
      data: {
        name: "DB",
        code: "DB",
        facultyId: facA.id,
        institutionId: instB.id,
      },
    });
    const repo = new PrismaStudentRepository(db);

    // facultyId → inst A, departmentId → inst B: spans institutions → rejected.
    await expect(
      repo.create({
        matricNumber: "XI/1",
        fullName: "Spanner",
        facultyId: facA.id,
        departmentId: depB.id,
        status: "ACTIVE",
      }),
    ).rejects.toThrow(/multiple institutions/);

    // A consistent placement resolves + stamps the institution.
    const ok = await repo.create({
      matricNumber: "XI/2",
      fullName: "Consistent",
      facultyId: facA.id,
      status: "ACTIVE",
    });
    expect(ok.institutionId).toBe(instA.id);
  });
});
