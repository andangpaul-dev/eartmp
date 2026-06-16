/**
 * resolveDbSalt couples the DB-at-rest salt to its encrypted database: a fresh
 * install mints a salt, but a missing/empty salt next to an EXISTING encrypted
 * DB fails loudly instead of orphaning it (minting a new salt would derive a
 * different key — SQLITE_NOTADB).
 */
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import {
  resolveDbSalt,
  MissingDbSaltError,
} from "../../src/infrastructure/db/encryptedDatabase";

const dirs: string[] = [];
function tempDb(): string {
  const d = mkdtempSync(join(tmpdir(), "eartmp-salt-"));
  dirs.push(d);
  return join(d, "eartmp.db");
}

afterEach(() => {
  while (dirs.length) {
    try {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe("resolveDbSalt", () => {
  it("mints and persists a salt on a fresh install (no DB, no salt)", () => {
    const db = tempDb();
    const salt = resolveDbSalt(db);
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(readFileSync(`${db}.salt`, "utf8").trim()).toBe(salt);
  });

  it("returns the existing salt and never rewrites it", () => {
    const db = tempDb();
    writeFileSync(`${db}.salt`, "deadbeef\n");
    expect(resolveDbSalt(db)).toBe("deadbeef");
  });

  it("mints a salt when the DB does not exist yet (even if a stale empty salt is present)", () => {
    const db = tempDb();
    writeFileSync(`${db}.salt`, "");
    const salt = resolveDbSalt(db);
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
  });

  it("refuses to mint a new salt when an encrypted DB already exists (missing salt)", () => {
    const db = tempDb();
    writeFileSync(db, "encrypted-bytes-here");
    expect(() => resolveDbSalt(db)).toThrow(MissingDbSaltError);
    // Must NOT have created a salt file that would orphan the DB.
    expect(existsSync(`${db}.salt`)).toBe(false);
  });

  it("refuses when the DB exists but the salt file is empty", () => {
    const db = tempDb();
    writeFileSync(db, "encrypted-bytes-here");
    writeFileSync(`${db}.salt`, "   \n");
    expect(() => resolveDbSalt(db)).toThrow(/empty/i);
  });
});
