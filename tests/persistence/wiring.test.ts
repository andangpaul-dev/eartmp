import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { Container } from "../../src/infrastructure/di/container";
import { wirePersistence, TOKENS } from "../../src/infrastructure/di/wiring";
import { PrismaUnitOfWork } from "../../src/infrastructure/persistence/PrismaUnitOfWork";

describe("wirePersistence", () => {
  it("registers the persistence ports + UnitOfWork in the container", () => {
    const container = new Container();
    // The factories only construct on resolve and never touch the DB here.
    wirePersistence(container, {} as PrismaClient);

    expect(container.has(TOKENS.UnitOfWork)).toBe(true);
    expect(container.has(TOKENS.StudentRepository)).toBe(true);
    expect(container.resolve(TOKENS.UnitOfWork)).toBeInstanceOf(
      PrismaUnitOfWork,
    );
  });
});
