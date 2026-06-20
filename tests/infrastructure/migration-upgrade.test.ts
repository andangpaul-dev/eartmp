/**
 * Migration UPGRADE path — proves the runtime migration runner (the exact code
 * that runs on every app launch) carries an EXISTING/old database forward when
 * new migrations ship, and is idempotent. This is the path that integration
 * tests (which always start fresh) don't exercise, and that couldn't be verified
 * on the locked production DB.
 *
 * Strategy: provision an "old" schema from every migration EXCEPT the two recent
 * additive ones, confirm their columns are absent, run the full set, confirm the
 * columns appear, then run again and confirm nothing re-applies.
 */
import { mkdtempSync, cpSync, existsSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { runMigrations } from "../../src/infrastructure/db/migrationRunner";

const MIGRATIONS = join(process.cwd(), "prisma", "migrations");
// The two most recent additive migrations whose upgrade we want to prove.
const RECENT = /template_category|notification_recipient/;

const DB = `${process.cwd().replace(/\\/g, "/")}/.tmp-upgrade.db`;
const URL = `file:${DB}`;

let db: PrismaClient;
let oldDir: string;

const cleanup = () => {
  for (const f of [DB, `${DB}-journal`]) if (existsSync(f)) rmSync(f);
};

beforeAll(() => {
  cleanup();
  db = new PrismaClient({ datasourceUrl: URL });
  // An "old app" migrations dir: everything except the two recent migrations.
  oldDir = mkdtempSync(join(tmpdir(), "eartmp-old-"));
  for (const e of readdirSync(MIGRATIONS, { withFileTypes: true })) {
    if (!e.isDirectory() || RECENT.test(e.name)) continue;
    cpSync(join(MIGRATIONS, e.name), join(oldDir, e.name), { recursive: true });
  }
});

afterAll(async () => {
  await db?.$disconnect();
  cleanup();
  if (oldDir && existsSync(oldDir))
    rmSync(oldDir, { recursive: true, force: true });
});

async function hasColumn(table: string, col: string): Promise<boolean> {
  // PRAGMA, not SELECT: SQLite treats a double-quoted unknown identifier as a
  // string literal, so `SELECT "col"` wouldn't error on a missing column.
  const cols = (await db.$queryRawUnsafe(`PRAGMA table_info("${table}")`)) as {
    name: string;
  }[];
  return cols.some((c) => c.name === col);
}

describe("runtime migration runner — upgrade path", () => {
  it("carries an old database forward with newly-shipped migrations, idempotently", async () => {
    // 1. Provision the OLD schema (without the two recent additive columns).
    await runMigrations(db, oldDir);
    expect(await hasColumn("TranscriptTemplate", "category")).toBe(false);
    expect(await hasColumn("Notification", "recipientRole")).toBe(false);

    // 2. Ship the new migrations → the runner applies ONLY the missing ones.
    const applied = await runMigrations(db, MIGRATIONS);
    expect(applied.some((n) => /template_category/.test(n))).toBe(true);
    expect(applied.some((n) => /notification_recipient/.test(n))).toBe(true);
    expect(await hasColumn("TranscriptTemplate", "category")).toBe(true);
    expect(await hasColumn("Notification", "recipientRole")).toBe(true);

    // 3. Idempotent: a second run re-applies nothing.
    expect(await runMigrations(db, MIGRATIONS)).toEqual([]);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Workstream C: MatriculeCounter + Student.previousStudentId upgrade path
// ---------------------------------------------------------------------------

const RECENT_C = /matricule_identity/;

const DB_C = `${process.cwd().replace(/\\/g, "/")}/.tmp-upgrade-c.db`;
const URL_C = `file:${DB_C}`;

let dbC: PrismaClient;
let oldDirC: string;

const cleanupC = () => {
  for (const f of [DB_C, `${DB_C}-journal`]) if (existsSync(f)) rmSync(f);
};

describe("runtime migration runner — Workstream C upgrade path (MatriculeCounter)", () => {
  beforeAll(() => {
    cleanupC();
    dbC = new PrismaClient({ datasourceUrl: URL_C });
    oldDirC = mkdtempSync(join(tmpdir(), "eartmp-old-c-"));
    for (const e of readdirSync(MIGRATIONS, { withFileTypes: true })) {
      if (!e.isDirectory() || RECENT_C.test(e.name)) continue;
      cpSync(join(MIGRATIONS, e.name), join(oldDirC, e.name), {
        recursive: true,
      });
    }
  });

  afterAll(async () => {
    await dbC?.$disconnect();
    cleanupC();
    if (oldDirC && existsSync(oldDirC))
      rmSync(oldDirC, { recursive: true, force: true });
  });

  it("adds MatriculeCounter + Student.previousStudentId", async () => {
    // 1. Provision the pre-C schema (columns/table absent).
    await runMigrations(dbC, oldDirC);
    const colsBefore = (await dbC.$queryRawUnsafe(
      `PRAGMA table_info("Student")`,
    )) as { name: string }[];
    expect(colsBefore.map((c) => c.name)).not.toContain("previousStudentId");
    const tblsBefore = (await dbC.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='MatriculeCounter'`,
    )) as { name: string }[];
    expect(tblsBefore.length).toBe(0);

    // 2. Ship the Workstream C migration.
    const applied = await runMigrations(dbC, MIGRATIONS);
    expect(applied.some((n) => /matricule_identity/.test(n))).toBe(true);

    // Student.previousStudentId column now present.
    const cols = (await dbC.$queryRawUnsafe(
      `PRAGMA table_info("Student")`,
    )) as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("previousStudentId");

    // MatriculeCounter table exists.
    const tbls = (await dbC.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='MatriculeCounter'`,
    )) as { name: string }[];
    expect(tbls.length).toBe(1);

    // Unique index exists.
    const idx = (await dbC.$queryRawUnsafe(
      `PRAGMA index_list("MatriculeCounter")`,
    )) as { name: string }[];
    expect(
      idx.some(
        (i) => i.name === "MatriculeCounter_institutionId_facultyId_year_key",
      ),
    ).toBe(true);

    // 3. Idempotent: a second run re-applies nothing.
    expect(await runMigrations(dbC, MIGRATIONS)).toEqual([]);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Workstream B: Result sitting/status upgrade path
// ---------------------------------------------------------------------------

// Exclude the Workstream B migration so we can simulate a pre-B database.
const RECENT_B = /result_sitting_status/;

const DB_B = `${process.cwd().replace(/\\/g, "/")}/.tmp-upgrade-b.db`;
const URL_B = `file:${DB_B}`;

let dbB: PrismaClient;
let oldDirB: string;

const cleanupB = () => {
  for (const f of [DB_B, `${DB_B}-journal`]) if (existsSync(f)) rmSync(f);
};

async function hasColumnB(table: string, col: string): Promise<boolean> {
  // PRAGMA, not SELECT: SQLite treats a double-quoted unknown identifier as a
  // string literal, so `SELECT "col"` wouldn't error on a missing column.
  const cols = (await dbB.$queryRawUnsafe(`PRAGMA table_info("${table}")`)) as {
    name: string;
  }[];
  return cols.some((c) => c.name === col);
}

async function hasIndexB(table: string, indexName: string): Promise<boolean> {
  const rows = (await dbB.$queryRawUnsafe(`PRAGMA index_list("${table}")`)) as {
    name: string;
  }[];
  return rows.some((r) => r.name === indexName);
}

describe("runtime migration runner — Workstream B upgrade path (Result sitting/status)", () => {
  beforeAll(() => {
    cleanupB();
    dbB = new PrismaClient({ datasourceUrl: URL_B });
    // An "old app" migrations dir: everything except the Workstream B migration.
    oldDirB = mkdtempSync(join(tmpdir(), "eartmp-old-b-"));
    for (const e of readdirSync(MIGRATIONS, { withFileTypes: true })) {
      if (!e.isDirectory() || RECENT_B.test(e.name)) continue;
      cpSync(join(MIGRATIONS, e.name), join(oldDirB, e.name), {
        recursive: true,
      });
    }
  });

  afterAll(async () => {
    await dbB?.$disconnect();
    cleanupB();
    if (oldDirB && existsSync(oldDirB))
      rmSync(oldDirB, { recursive: true, force: true });
  });

  it("adds sitting/status columns and re-keyed unique index on upgrade, idempotently", async () => {
    // 1. Provision the pre-B schema (sitting/status columns absent).
    await runMigrations(dbB, oldDirB);
    expect(await hasColumnB("Result", "sitting")).toBe(false);
    expect(await hasColumnB("Result", "status")).toBe(false);

    // 2. Ship the Workstream B migration → runner applies only the missing one.
    const applied = await runMigrations(dbB, MIGRATIONS);
    expect(applied.some((n) => /result_sitting_status/.test(n))).toBe(true);

    // Columns now present.
    expect(await hasColumnB("Result", "sitting")).toBe(true);
    expect(await hasColumnB("Result", "status")).toBe(true);

    // New composite unique index exists, old one is gone.
    expect(
      await hasIndexB(
        "Result",
        "Result_studentId_courseId_semesterId_sitting_key",
      ),
    ).toBe(true);
    expect(
      await hasIndexB("Result", "Result_studentId_courseId_semesterId_key"),
    ).toBe(false);

    // 3. Idempotent: a second run re-applies nothing.
    expect(await runMigrations(dbB, MIGRATIONS)).toEqual([]);
  }, 60_000);
});
