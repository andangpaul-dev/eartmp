/**
 * First-launch / update database bootstrap (R-3 / F-32). Applies the shipped
 * Prisma migration SQL through the connection (no Prisma CLI/engine at runtime)
 * via the tracked, transactional migration runner, then seeds the default
 * configuration + admin user on a fresh database. Idempotent: re-launches apply
 * only newly-shipped migrations and skip seeding.
 */
import type { PrismaClient } from "@prisma/client";
import { runMigrations } from "./migrationRunner";
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

/**
 * Ensure the database is migrated + seeded. Applies any pending migrations
 * (incremental, transactional) and seeds only when the database was empty.
 * Returns true if it provisioned a fresh database, false if it was already
 * initialized.
 */
export async function bootstrapDatabase(
  prisma: PrismaClient,
  migrationsDir: string,
): Promise<boolean> {
  const fresh = !(await isInitialized(prisma));
  await runMigrations(prisma, migrationsDir);
  if (fresh) {
    await seedDatabase(prisma);
  }
  // Optional sample data for UAT/test builds (idempotent; off by default).
  if (process.env.EARTMP_SEED_DEMO) await seedDemoData(prisma);
  return fresh;
}
