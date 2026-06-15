/**
 * Tier 1: prove the first-launch bootstrap (apply migrations + seed) works over
 * an ENCRYPTED libSQL connection — the foundation for the encrypted-at-rest host
 * path. Migrations are standard SQLite DDL; the seed runs Prisma writes. If this
 * holds, the host can open the encrypted client at unlock and provision into it.
 */
import { rmSync, readFileSync, existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, describe, expect, it } from "vitest";
import { getEncryptedPrisma } from "../../src/infrastructure/db/encryptedDatabase";
import { bootstrapDatabase } from "../../src/infrastructure/db/bootstrap";

const FILE = "./.tmp-enc-bootstrap.db";

async function cleanup(): Promise<void> {
  for (const f of [FILE, `${FILE}-wal`, `${FILE}-shm`, `${FILE}-journal`]) {
    for (let i = 0; i < 20 && existsSync(f); i++) {
      try {
        rmSync(f, { force: true });
      } catch {
        await delay(50);
      }
    }
  }
}

afterAll(cleanup);

describe("encrypted bootstrap (ADR-008)", () => {
  it(
    "applies migrations + seed over an encrypted DB, then admin exists",
    { timeout: 30000 },
    async () => {
      await cleanup();
      const prisma = await getEncryptedPrisma(
        "operator-pass",
        "institution.encryptionSalt:boot",
        FILE,
      );
      const provisioned = await bootstrapDatabase(prisma, "prisma/migrations");
      expect(provisioned).toBe(true);

      const admin = await prisma.user.findUnique({
        where: { username: "admin" },
      });
      expect(admin?.username).toBe("admin");
      const roles = await prisma.role.findMany();
      expect(roles.length).toBeGreaterThanOrEqual(4);
      await prisma.$disconnect();

      // The file on disk is encrypted, not a plaintext SQLite database.
      const header = readFileSync(FILE).subarray(0, 16).toString("latin1");
      expect(header.startsWith("SQLite format 3")).toBe(false);
    },
  );
});
