/**
 * Integration test for PrismaMatriculeCounter (Workstream C, Task 2.1).
 * Uses a throwaway SQLite database — same harness as semester-ordering.test.ts.
 */
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaMatriculeCounter } from "../../src/infrastructure/repositories/PrismaRecordsRepositories";

const TMP = `${process.cwd().replace(/\\/g, "/")}/.tmp-matricule-counter.db`;
const URL = `file:${TMP}`;

let db: PrismaClient;

beforeAll(async () => {
  for (const f of [TMP, `${TMP}-journal`]) if (existsSync(f)) rmSync(f);
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: URL },
    stdio: "pipe",
  });
  db = new PrismaClient({ datasourceUrl: URL });
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  for (const f of [TMP, `${TMP}-journal`]) if (existsSync(f)) rmSync(f);
});

describe("PrismaMatriculeCounter", () => {
  it("reserve increments per (faculty,year); peek does not", async () => {
    const repo = new PrismaMatriculeCounter(db);
    expect(await repo.peek(null, "facA", 2025)).toBe(1);
    expect(await repo.reserve(null, "facA", 2025)).toBe(1);
    expect(await repo.reserve(null, "facA", 2025)).toBe(2);
    expect(await repo.peek(null, "facA", 2025)).toBe(3);
    expect(await repo.reserve(null, "facB", 2025)).toBe(1);
  });

  it('null and "" resolve to the SAME bucket (sentinel consistency, FIX B)', async () => {
    const repo = new PrismaMatriculeCounter(db);
    // reserve with null — should claim slot 1 for the default-institution bucket
    expect(await repo.reserve(null, "facC", 2026)).toBe(1);
    // peek with "" should see next=2 (same bucket via "" sentinel)
    expect(await repo.peek("", "facC", 2026)).toBe(2);
  });
});
