/**
 * DB-at-rest encryption (ADR-008) — the encrypted libSQL Prisma factory the
 * packaged sidecar uses. Proves Prisma genuinely reads/writes an encrypted
 * database, that the file on disk is not a plaintext SQLite database, and that
 * the wrong key cannot read it. Runs in node env (native libSQL driver).
 *
 * Each test uses its own DB file: libSQL releases the native file handle a beat
 * after $disconnect on Windows, so a shared file would race the lock between
 * tests. Leftover temp files (if any) are best-effort cleaned at the end.
 */
import { rmSync, readFileSync, existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, describe, expect, it } from "vitest";
import {
  deriveDbKey,
  getEncryptedPrisma,
} from "../../src/infrastructure/db/encryptedDatabase";

const files = new Set<string>();
function tmp(name: string): string {
  const f = `./.tmp-enc-${name}.db`;
  files.add(f);
  return f;
}

async function removeBestEffort(file: string): Promise<void> {
  for (const f of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) {
    for (let i = 0; i < 20 && existsSync(f); i++) {
      try {
        rmSync(f, { force: true });
      } catch {
        await delay(50);
      }
    }
  }
}

afterAll(async () => {
  for (const f of files) await removeBestEffort(f);
});

describe("encryptedDatabase (ADR-008)", () => {
  it("derives a deterministic 32-byte key from passphrase + salt", async () => {
    const a = await deriveDbKey("pass", "institution.encryptionSalt:x");
    const b = await deriveDbKey("pass", "institution.encryptionSalt:x");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    const c = await deriveDbKey("pass", "institution.encryptionSalt:y");
    expect(c).not.toBe(a);
  });

  it("Prisma reads/writes an encrypted DB that is not plaintext SQLite", async () => {
    const file = tmp("rw");
    await removeBestEffort(file);
    const prisma = await getEncryptedPrisma(
      "operator",
      "institution.encryptionSalt:1",
      file,
    );
    await prisma.$executeRawUnsafe(
      "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)",
    );
    await prisma.$executeRawUnsafe("INSERT INTO t (v) VALUES ('secret')");
    const rows =
      await prisma.$queryRawUnsafe<{ v: string }[]>("SELECT v FROM t");
    expect(rows[0]?.v).toBe("secret");
    await prisma.$disconnect();

    const header = readFileSync(file).subarray(0, 16).toString("latin1");
    expect(header.startsWith("SQLite format 3")).toBe(false);
  });

  it("sets PRAGMA busy_timeout so transient locks wait instead of failing", async () => {
    const file = tmp("busy-timeout");
    await removeBestEffort(file);
    const prisma = await getEncryptedPrisma(
      "operator",
      "institution.encryptionSalt:busy",
      file,
    );
    // provision a table so the connection is live
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS t (id INTEGER)`);
    const rows =
      await prisma.$queryRawUnsafe<{ timeout: number }[]>(
        `PRAGMA busy_timeout`,
      );
    // PRAGMA busy_timeout returns a single row { timeout: <ms> }
    const val = Number(
      (rows[0] as Record<string, unknown>)?.timeout ??
        Object.values(rows[0] ?? {})[0],
    );
    expect(val).toBe(5000);
    await prisma.$disconnect();
  });

  it("rejects the wrong key", async () => {
    const file = tmp("wrongkey");
    await removeBestEffort(file);
    const prisma = await getEncryptedPrisma(
      "operator",
      "institution.encryptionSalt:2",
      file,
    );
    await prisma.$executeRawUnsafe(
      "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)",
    );
    await prisma.$executeRawUnsafe("INSERT INTO t (v) VALUES ('payload')");
    await prisma.$disconnect();

    const wrong = await getEncryptedPrisma(
      "operator",
      "institution.encryptionSalt:DIFFERENT",
      file,
    );
    let rejected = false;
    try {
      await wrong.$queryRawUnsafe("SELECT v FROM t");
    } catch {
      rejected = true; // SQLITE_NOTADB — the file cannot be decrypted
    } finally {
      try {
        await wrong.$disconnect();
      } catch {
        /* connection already faulted */
      }
    }
    expect(rejected).toBe(true);
  });
});
