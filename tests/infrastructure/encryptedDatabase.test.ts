/**
 * DB-at-rest encryption (ADR-008) — the SQLCipher helper the packaged sidecar
 * uses. Proves the file is genuinely encrypted, the right key round-trips, and a
 * wrong key is rejected. Runs in node env (native SQLite driver).
 */
import { rmSync, readFileSync, existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  deriveDbKey,
  openEncryptedDatabase,
} from "../../src/infrastructure/db/encryptedDatabase";

const FILE = "./.tmp-enc-test.db";

function cleanup(): void {
  for (const f of [FILE, `${FILE}-wal`, `${FILE}-shm`, `${FILE}-journal`]) {
    if (existsSync(f)) rmSync(f, { force: true });
  }
}

describe("encryptedDatabase (ADR-008)", () => {
  afterEach(cleanup);

  it("derives a deterministic 32-byte key from passphrase + salt", async () => {
    const a = await deriveDbKey("pass", "institution.encryptionSalt:x");
    const b = await deriveDbKey("pass", "institution.encryptionSalt:x");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    const c = await deriveDbKey("pass", "institution.encryptionSalt:y");
    expect(c).not.toBe(a);
  });

  it("writes an encrypted file that is not a plaintext SQLite database", async () => {
    cleanup();
    const key = await deriveDbKey("operator", "institution.encryptionSalt:1");
    const db = openEncryptedDatabase(FILE, key);
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    db.prepare("INSERT INTO t (v) VALUES (?)").run("secret");
    db.close();

    const header = readFileSync(FILE).subarray(0, 16).toString("latin1");
    expect(header.startsWith("SQLite format 3")).toBe(false);
  });

  it("round-trips with the right key and rejects the wrong key", async () => {
    cleanup();
    const key = await deriveDbKey("operator", "institution.encryptionSalt:2");
    {
      const db = openEncryptedDatabase(FILE, key);
      db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
      db.prepare("INSERT INTO t (v) VALUES (?)").run("payload");
      db.close();
    }
    {
      const db = openEncryptedDatabase(FILE, key);
      const row = db.prepare("SELECT v FROM t WHERE id = 1").get() as {
        v: string;
      };
      expect(row.v).toBe("payload");
      db.close();
    }

    const wrong = key.replace(/^./, key[0] === "a" ? "b" : "a");
    let db: ReturnType<typeof openEncryptedDatabase> | undefined;
    expect(() => {
      try {
        db = openEncryptedDatabase(FILE, wrong);
        db.prepare("SELECT v FROM t WHERE id = 1").get();
      } finally {
        db?.close();
      }
    }).toThrow();
  });

  it("rejects a malformed key", () => {
    expect(() => openEncryptedDatabase(FILE, "tooshort")).toThrow(/32 bytes/);
  });
});
