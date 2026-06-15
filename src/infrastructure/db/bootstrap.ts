/**
 * First-launch database bootstrap (R-3 / F-32). On a fresh install the SQLite
 * file is empty; this applies the shipped Prisma migration SQL through the
 * connection (no Prisma CLI/engine needed at runtime), then seeds the default
 * configuration + admin user. Idempotent: if the schema already exists it is a
 * no-op, so the dev DB and re-launches are untouched.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { seedDatabase } from "./seed";
import { seedDemoData } from "./demoData";

async function isInitialized(prisma: PrismaClient): Promise<boolean> {
  try {
    await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1');
    return true;
  } catch {
    return false;
  }
}

/** Apply every `<dir>/migration.sql` in chronological (name) order. */
async function applyMigrations(
  prisma: PrismaClient,
  migrationsDir: string,
): Promise<number> {
  if (!existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  let count = 0;
  for (const dir of dirs) {
    const file = join(migrationsDir, dir, "migration.sql");
    if (!existsSync(file)) continue;
    const sql = readFileSync(file, "utf8");
    // Prisma SQLite migrations are `;`-terminated statements with `-- ` comments
    // and no embedded semicolons; strip comments, split, run each.
    const statements = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) await prisma.$executeRawUnsafe(stmt);
    count++;
  }
  return count;
}

/**
 * Ensure the database is migrated + seeded. Returns true if it provisioned a
 * fresh database, false if it was already initialized.
 */
export async function bootstrapDatabase(
  prisma: PrismaClient,
  migrationsDir: string,
): Promise<boolean> {
  const fresh = !(await isInitialized(prisma));
  if (fresh) {
    await applyMigrations(prisma, migrationsDir);
    await seedDatabase(prisma);
  }
  // Optional sample data for UAT/test builds (idempotent; off by default).
  if (process.env.EARTMP_SEED_DEMO) await seedDemoData(prisma);
  return fresh;
}
