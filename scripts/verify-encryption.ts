/**
 * Verify DB-at-rest encryption (Item 2 / ADR-008). Proves the mechanism the
 * packaged sidecar will use: derive a 32-byte key from the operator passphrase +
 * institution.encryptionSalt via the existing Argon2 KeyDerivationPort, open an
 * SQLCipher-encrypted SQLite file with it, and confirm:
 *   1. the file on disk is NOT a plaintext SQLite database (header is encrypted),
 *   2. the right key round-trips the data,
 *   3. the wrong key is rejected,
 *   4. opening with no key is rejected.
 * Run: npm run verify:encryption
 */
import { rmSync, readFileSync, existsSync } from "node:fs";
import Database from "better-sqlite3-multiple-ciphers";
import {
  deriveDbKey,
  openEncryptedDatabase,
} from "../src/infrastructure/db/encryptedDatabase";

const FILE = "./.tmp-encrypted.db";
const PASSPHRASE = "operator-unlock-passphrase";
const SALT = "institution.encryptionSalt:demo-0001"; // from the settings store

const openKeyed = (path: string, keyHex: string): Database.Database =>
  openEncryptedDatabase(path, keyHex);

function cleanup(): void {
  for (const f of [FILE, `${FILE}-wal`, `${FILE}-shm`, `${FILE}-journal`]) {
    if (existsSync(f)) rmSync(f, { force: true });
  }
}

async function main(): Promise<void> {
  cleanup();
  let ok = true;
  const check = (label: string, pass: boolean, extra = ""): void => {
    ok = ok && pass;
    console.log(`   ${pass ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
  };

  const key = await deriveDbKey(PASSPHRASE, SALT);
  console.log(`1) derived 32-byte key from passphrase + salt (Argon2id):`);
  check("64 hex chars", /^[0-9a-f]{64}$/.test(key));

  console.log("2) create + write an encrypted database:");
  {
    const db = openKeyed(FILE, key);
    db.exec("CREATE TABLE secret (id INTEGER PRIMARY KEY, note TEXT)");
    db.prepare("INSERT INTO secret (note) VALUES (?)").run(
      "transcript-signing-and-records",
    );
    db.close();
  }
  check("file written", existsSync(FILE));

  console.log("3) on-disk file is NOT a plaintext SQLite database:");
  const header = readFileSync(FILE).subarray(0, 16).toString("latin1");
  check(
    "encrypted header",
    !header.startsWith("SQLite format 3"),
    `header=${JSON.stringify(header.replace(/[^\x20-\x7e]/g, "."))}`,
  );

  console.log("4) right key reads the row back:");
  {
    const db = openKeyed(FILE, key);
    const row = db.prepare("SELECT note FROM secret WHERE id = 1").get() as {
      note: string;
    };
    check("round-trips", row?.note === "transcript-signing-and-records");
    db.close();
  }

  console.log("5) wrong key is rejected:");
  {
    const wrong = key.replace(/^./, key[0] === "a" ? "b" : "a");
    let db: Database.Database | undefined;
    let rejected = false;
    try {
      db = openKeyed(FILE, wrong);
      db.prepare("SELECT note FROM secret WHERE id = 1").get();
    } catch {
      rejected = true;
    } finally {
      db?.close();
    }
    check("rejected", rejected);
  }

  console.log("6) opening with no key is rejected:");
  {
    let db: Database.Database | undefined;
    let rejected = false;
    try {
      db = new Database(FILE);
      db.prepare("SELECT note FROM secret WHERE id = 1").get();
    } catch {
      rejected = true;
    } finally {
      db?.close();
    }
    check("rejected", rejected);
  }

  cleanup();
  console.log(`\nDB-at-rest encryption: ${ok ? "GREEN ✅" : "RED ❌"}`);
  if (!ok) process.exitCode = 1;
}

main().catch((e) => {
  cleanup();
  console.error(e);
  process.exitCode = 1;
});
