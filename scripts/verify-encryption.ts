/**
 * Demonstrate DB-at-rest encryption (ADR-008) end to end: derive a key from the
 * operator passphrase + institution.encryptionSalt, then have PRISMA itself
 * read/write an encrypted libSQL database and confirm the file on disk is not a
 * plaintext SQLite database and the wrong key is rejected.
 * Run: npm run verify:encryption
 */
import { rmSync, readFileSync, existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { getEncryptedPrisma } from "../src/infrastructure/db/encryptedDatabase";

const FILE = "./.tmp-encrypted.db";
const PASSPHRASE = "operator-unlock-passphrase";
const SALT = "institution.encryptionSalt:demo-0001";

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

async function main(): Promise<void> {
  await cleanup();
  let ok = true;
  const check = (label: string, pass: boolean, extra = ""): void => {
    ok = ok && pass;
    console.log(`   ${pass ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
  };

  console.log("1) Prisma writes + reads an encrypted libSQL database:");
  const prisma = await getEncryptedPrisma(PASSPHRASE, SALT, FILE);
  await prisma.$executeRawUnsafe(
    "CREATE TABLE secret (id INTEGER PRIMARY KEY, note TEXT)",
  );
  await prisma.$executeRawUnsafe(
    "INSERT INTO secret (note) VALUES ('records-and-transcripts')",
  );
  const rows = await prisma.$queryRawUnsafe<{ note: string }[]>(
    "SELECT note FROM secret",
  );
  check(
    "round-trips through Prisma",
    rows[0]?.note === "records-and-transcripts",
  );
  await prisma.$disconnect();

  console.log("2) on-disk file is NOT a plaintext SQLite database:");
  const header = readFileSync(FILE).subarray(0, 16).toString("latin1");
  check("encrypted header", !header.startsWith("SQLite format 3"));

  console.log("3) the wrong key cannot read it:");
  const wrong = await getEncryptedPrisma(PASSPHRASE, `${SALT}-different`, FILE);
  let rejected = false;
  try {
    await wrong.$queryRawUnsafe("SELECT note FROM secret");
  } catch {
    rejected = true;
  } finally {
    try {
      await wrong.$disconnect();
    } catch {
      /* faulted */
    }
  }
  check("rejected", rejected);

  await cleanup();
  console.log(`\nDB-at-rest encryption: ${ok ? "GREEN ✅" : "RED ❌"}`);
  if (!ok) process.exitCode = 1;
}

main().catch(async (e) => {
  await cleanup();
  console.error(e);
  process.exitCode = 1;
});
