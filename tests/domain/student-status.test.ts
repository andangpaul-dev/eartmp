import { describe, it, expect } from "vitest";
import {
  canTransition,
  STUDENT_STATUS_TRANSITIONS,
} from "../../src/domain/entities/student-status";

describe("canTransition", () => {
  it("allows legal forward transitions from ACTIVE", () => {
    expect(canTransition("ACTIVE", "SUSPENDED")).toBe(true);
    expect(canTransition("ACTIVE", "DEFERRED")).toBe(true);
    expect(canTransition("ACTIVE", "WITHDRAWN")).toBe(true);
    expect(canTransition("ACTIVE", "GRADUATED")).toBe(true);
  });

  it("allows WITHDRAWN→ACTIVE for re-admission", () => {
    expect(canTransition("WITHDRAWN", "ACTIVE")).toBe(true);
  });

  it("does not allow WITHDRAWN→SUSPENDED", () => {
    expect(canTransition("WITHDRAWN", "SUSPENDED")).toBe(false);
  });

  it("does not allow GRADUATED→ACTIVE (graduated students get new records)", () => {
    expect(canTransition("GRADUATED", "ACTIVE")).toBe(false);
  });

  it("GRADUATED is truly terminal (no outgoing transitions)", () => {
    expect(STUDENT_STATUS_TRANSITIONS["GRADUATED"]).toHaveLength(0);
  });

  it("allows SUSPENDED→ACTIVE and SUSPENDED→WITHDRAWN", () => {
    expect(canTransition("SUSPENDED", "ACTIVE")).toBe(true);
    expect(canTransition("SUSPENDED", "WITHDRAWN")).toBe(true);
  });

  it("allows DEFERRED→ACTIVE and DEFERRED→WITHDRAWN", () => {
    expect(canTransition("DEFERRED", "ACTIVE")).toBe(true);
    expect(canTransition("DEFERRED", "WITHDRAWN")).toBe(true);
  });
});
