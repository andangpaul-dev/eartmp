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
