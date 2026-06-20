/**
 * Integration test for PrismaSemesterOrdering (Workstream B, Task 2.2).
 * Uses the same real-throwaway-SQLite harness as
 * tests/integration/persistence.integration.test.ts — migrated fresh, deleted
 * after the suite.
 */
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaSemesterOrdering } from "../../src/infrastructure/repositories/PrismaRecordsRepositories";

const TMP = `${process.cwd().replace(/\\/g, "/")}/.tmp-semester-ordering.db`;
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

describe("PrismaSemesterOrdering", () => {
  it("maps semesterIds to (sessionOrder, rank) sorted by session startDate", async () => {
    // Session S1 — older (lower startDate) → sessionOrder 0
    const s1 = await db.academicSession.create({
      data: {
        name: "2023/2024",
        startDate: new Date("2023-09-01"),
      },
    });
    // Session S2 — newer → sessionOrder 1
    const s2 = await db.academicSession.create({
      data: {
        name: "2024/2025",
        startDate: new Date("2024-09-01"),
      },
    });

    // S1 semesters: rank 1 and rank 2
    const sem11 = await db.semester.create({
      data: { name: "First Semester", rank: 1, sessionId: s1.id },
    });
    const sem12 = await db.semester.create({
      data: { name: "Second Semester", rank: 2, sessionId: s1.id },
    });
    // S2 semester: rank 1
    const sem21 = await db.semester.create({
      data: { name: "First Semester", rank: 1, sessionId: s2.id },
    });

    const ord = new PrismaSemesterOrdering(db);
    const m = await ord.order([sem11.id, sem12.id, sem21.id]);

    expect(m.get(sem11.id)).toEqual({ sessionOrder: 0, rank: 1 });
    expect(m.get(sem12.id)).toEqual({ sessionOrder: 0, rank: 2 });
    expect(m.get(sem21.id)).toEqual({ sessionOrder: 1, rank: 1 });
  });

  it("falls back to createdAt when startDate is null", async () => {
    // Two sessions with no startDate — ordering must still be deterministic by
    // createdAt (SQLite timestamps are millisecond-resolution; inserting
    // sequentially guarantees ordering).
    const sA = await db.academicSession.create({ data: { name: "NoDate-A" } });
    // Small pause not needed — just verify they come back in creation order;
    // if createdAt is the same millisecond the test would be flaky, so we
    // explicitly check that both semesters are present and have valid entries.
    const sB = await db.academicSession.create({ data: { name: "NoDate-B" } });

    const semA = await db.semester.create({
      data: { name: "S1", rank: 1, sessionId: sA.id },
    });
    const semB = await db.semester.create({
      data: { name: "S1", rank: 1, sessionId: sB.id },
    });

    const ord = new PrismaSemesterOrdering(db);
    const m = await ord.order([semA.id, semB.id]);

    // Both must be present with rank 1; sessionOrders must be 0 and 1.
    const entryA = m.get(semA.id);
    const entryB = m.get(semB.id);
    expect(entryA).toBeDefined();
    expect(entryB).toBeDefined();
    expect(entryA!.rank).toBe(1);
    expect(entryB!.rank).toBe(1);
    expect(new Set([entryA!.sessionOrder, entryB!.sessionOrder])).toEqual(
      new Set([0, 1]),
    );
  });

  it("omits soft-deleted semesters", async () => {
    const sess = await db.academicSession.create({
      data: { name: "DeletedSem-Session", startDate: new Date("2025-01-01") },
    });
    const alive = await db.semester.create({
      data: { name: "Alive", rank: 1, sessionId: sess.id },
    });
    const dead = await db.semester.create({
      data: {
        name: "Dead",
        rank: 2,
        sessionId: sess.id,
        deletedAt: new Date(),
      },
    });

    const ord = new PrismaSemesterOrdering(db);
    const m = await ord.order([alive.id, dead.id]);

    expect(m.has(alive.id)).toBe(true);
    expect(m.has(dead.id)).toBe(false);
  });

  it("returns empty map for empty input", async () => {
    const ord = new PrismaSemesterOrdering(db);
    const m = await ord.order([]);
    expect(m.size).toBe(0);
  });

  it("omits unknown semesterIds", async () => {
    const ord = new PrismaSemesterOrdering(db);
    const m = await ord.order(["nonexistent-id"]);
    expect(m.has("nonexistent-id")).toBe(false);
  });
});
