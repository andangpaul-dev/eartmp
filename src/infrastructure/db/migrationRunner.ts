/**
 * Runtime migration runner (R-3 / F-32). Applies the shipped Prisma migration
 * SQL through the live connection — no Prisma CLI/engine at runtime — with three
 * properties the naive first-launch path lacked:
 *
 *  1. Per-migration tracking. A `_eartmp_migrations` table records every applied
 *     migration by name, so an app UPDATE that ships new migrations applies only
 *     the pending ones instead of doing nothing on an already-initialized DB.
 *  2. Transactional per migration. Each migration's statements + its tracking
 *     row commit together; a failure rolls the whole migration back, never
 *     leaving a half-applied schema.
 *  3. A quote/comment-aware splitter. Semicolons inside string literals or
 *     comments no longer break a statement in two.
 *
 * A pre-existing schema with no tracking table is BASELINED: its migrations are
 * recorded as applied without re-running them, so DBs provisioned by the old
 * first-launch path upgrade cleanly.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";

const TRACKING_TABLE = "_eartmp_migrations";

/**
 * Split a SQL script into individual statements. Splits on `;` at the top level
 * only — semicolons inside '…' / "…" quotes (including '' and "" escapes) and
 * inside -- line and /* *\/ block comments are ignored. Comments are stripped
 * from the emitted statements.
 */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    const next = i + 1 < sql.length ? sql[i + 1] : "";

    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        buf += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inSingle) {
      buf += ch;
      if (ch === "'") {
        if (next === "'") {
          buf += next;
          i++;
        } else {
          inSingle = false;
        }
      }
      continue;
    }
    if (inDouble) {
      buf += ch;
      if (ch === '"') {
        if (next === '"') {
          buf += next;
          i++;
        } else {
          inDouble = false;
        }
      }
      continue;
    }

    // Not inside a string or comment.
    if (ch === "-" && next === "-") {
      inLine = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      buf += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      buf += ch;
      continue;
    }
    if (ch === ";") {
      const stmt = buf.trim();
      if (stmt.length > 0) out.push(stmt);
      buf = "";
      continue;
    }
    buf += ch;
  }

  const tail = buf.trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

async function ensureTrackingTable(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "${TRACKING_TABLE}" (` +
      `"name" TEXT PRIMARY KEY NOT NULL, ` +
      `"applied_at" TEXT NOT NULL)`,
  );
}

async function appliedMigrations(prisma: PrismaClient): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT "name" FROM "${TRACKING_TABLE}"`,
  );
  return new Set(rows.map((r) => r.name));
}

/** True if the core schema already exists (the `User` table is queryable). */
async function schemaExists(prisma: PrismaClient): Promise<boolean> {
  try {
    await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1');
    return true;
  } catch {
    return false;
  }
}

function listMigrationDirs(migrationsDir: string): string[] {
  if (!existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => existsSync(join(migrationsDir, name, "migration.sql")))
    .sort();
}

/**
 * Apply all pending migrations in chronological (name) order. Returns the names
 * actually applied this run. Idempotent: already-tracked migrations are skipped;
 * an untracked pre-existing schema is baselined.
 */
export async function runMigrations(
  prisma: PrismaClient,
  migrationsDir: string,
): Promise<string[]> {
  await ensureTrackingTable(prisma);
  const dirs = listMigrationDirs(migrationsDir);
  let applied = await appliedMigrations(prisma);

  // Baseline: a schema that predates the tracking table. Record every shipped
  // migration as applied without running it, so we don't try to re-create
  // existing tables.
  if (applied.size === 0 && (await schemaExists(prisma))) {
    const now = new Date().toISOString();
    for (const name of dirs) {
      await prisma.$executeRawUnsafe(
        `INSERT OR IGNORE INTO "${TRACKING_TABLE}" ("name", "applied_at") VALUES (?, ?)`,
        name,
        now,
      );
    }
    applied = await appliedMigrations(prisma);
  }

  const ran: string[] = [];
  for (const name of dirs) {
    if (applied.has(name)) continue;
    const sql = readFileSync(
      join(migrationsDir, name, "migration.sql"),
      "utf8",
    );
    const statements = splitSqlStatements(sql);

    // Each migration + its tracking row commit together (interactive tx).
    await prisma.$transaction(async (tx) => {
      for (const stmt of statements) {
        await tx.$executeRawUnsafe(stmt);
      }
      await tx.$executeRawUnsafe(
        `INSERT INTO "${TRACKING_TABLE}" ("name", "applied_at") VALUES (?, ?)`,
        name,
        new Date().toISOString(),
      );
    });
    ran.push(name);
  }
  return ran;
}
