/**
 * DI container scaffold tests. The container is infrastructure plumbing, so it
 * is outside the business-logic coverage gate, but its behaviour is verified
 * here because later phases rely on it.
 */
import { describe, it, expect } from "vitest";
import { Container, buildContainer } from "../src/infrastructure/di/container";

describe("Container", () => {
  it("resolves a registered factory and memoises the instance", () => {
    const c = new Container();
    let calls = 0;
    c.register("svc", () => ({ id: ++calls }));
    const a = c.resolve<{ id: number }>("svc");
    const b = c.resolve<{ id: number }>("svc");
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });

  it("throws for an unregistered token", () => {
    const c = new Container();
    expect(() => c.resolve("missing")).toThrow(/No provider registered/);
  });

  it("reports registration via has()", () => {
    const c = new Container();
    expect(c.has("x")).toBe(false);
    c.register("x", () => 1);
    expect(c.has("x")).toBe(true);
  });

  it("buildContainer() returns an empty container in Phase 1", () => {
    expect(buildContainer().has("ResultRepository")).toBe(false);
  });
});
