import { describe, it, expect } from "vitest";
import {
  orderAttempts,
  selectEffective,
  type Attempt,
} from "../../src/domain/services/ResultAttempts";

const a = (over: Partial<Attempt>): Attempt => ({
  id: "x",
  courseId: "C",
  sessionOrder: 0,
  semesterRank: 1,
  sitting: "NORMAL",
  status: "GRADED",
  ...over,
});

describe("ResultAttempts", () => {
  it("orders by session, then semester rank, then NORMAL before RESIT", () => {
    const out = orderAttempts([
      a({ id: "resit", sitting: "RESIT" }),
      a({ id: "normal", sitting: "NORMAL" }),
      a({ id: "nextYear", sessionOrder: 1 }),
    ]);
    expect(out.map((x) => x.id)).toEqual(["normal", "resit", "nextYear"]);
  });
  it("per course, the latest attempt is effective; earlier ones discounted", () => {
    const sel = selectEffective([
      a({ id: "f", sitting: "NORMAL", status: "DID" }),
      a({ id: "c", sitting: "RESIT", status: "GRADED" }),
    ]);
    expect(sel.effectiveIds.has("c")).toBe(true);
    expect(sel.effectiveIds.has("f")).toBe(false);
    expect(sel.isReattempt("c")).toBe(true);
    expect(sel.isReattempt("f")).toBe(false);
  });
  it("cross-session carryover: later-session retake is effective", () => {
    const sel = selectEffective([
      a({ id: "f", courseId: "M", sessionOrder: 0, status: "GRADED" }),
      a({ id: "b", courseId: "M", sessionOrder: 1, status: "GRADED" }),
    ]);
    expect(sel.effectiveIds.has("b")).toBe(true);
    expect(sel.isReattempt("b")).toBe(true);
  });
  it("an INCOMPLETE latest attempt makes the course pending (not effective for GPA)", () => {
    const sel = selectEffective([a({ id: "i", status: "INCOMPLETE" })]);
    expect(sel.effectiveIds.has("i")).toBe(false);
    expect(sel.pendingCourseIds.has("C")).toBe(true);
  });
  it("courses are independent", () => {
    const sel = selectEffective([
      a({ id: "c1", courseId: "A" }),
      a({ id: "c2", courseId: "B" }),
    ]);
    expect(sel.effectiveIds.has("c1")).toBe(true);
    expect(sel.effectiveIds.has("c2")).toBe(true);
  });
});
