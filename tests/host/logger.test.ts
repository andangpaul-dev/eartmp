/**
 * App-data file logging: mirrors console output to a rotating host.log.
 */
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import {
  initFileLogging,
  startFileLoggingFromEnv,
} from "../../src/host/logger";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "eartmp-log-"));
  dirs.push(d);
  return d;
}

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()!;
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe("file logging", () => {
  it("mirrors console output to host.log and still writes to console", () => {
    const dir = tempDir();
    const restore = initFileLogging({ dir });
    try {
      console.log("hello", { a: 1 });
      console.error("boom");
    } finally {
      restore();
    }
    const contents = readFileSync(join(dir, "host.log"), "utf8");
    expect(contents).toMatch(/\[log\] hello \{ a: 1 \}/);
    expect(contents).toMatch(/\[error\] boom/);
    // ISO timestamp prefix on each line.
    expect(contents).toMatch(/^\d{4}-\d{2}-\d{2}T/m);
  });

  it("restores the original console methods", () => {
    const dir = tempDir();
    const before = console.log;
    const restore = initFileLogging({ dir });
    expect(console.log).not.toBe(before);
    restore();
    expect(console.log).toBe(before);
  });

  it("rotates to host.log.1 when the cap is exceeded", () => {
    const dir = tempDir();
    const restore = initFileLogging({ dir, maxBytes: 200 });
    try {
      for (let i = 0; i < 50; i++) console.log("x".repeat(40), i);
    } finally {
      restore();
    }
    expect(existsSync(join(dir, "host.log"))).toBe(true);
    expect(existsSync(join(dir, "host.log.1"))).toBe(true);
  });

  it("is a no-op without EARTMP_LOG_DIR", () => {
    expect(startFileLoggingFromEnv({})).toBeNull();
    const before = console.log;
    const restore = startFileLoggingFromEnv({ EARTMP_LOG_DIR: "" });
    expect(restore).toBeNull();
    expect(console.log).toBe(before);
  });

  it("starts from EARTMP_LOG_DIR when set", () => {
    const dir = tempDir();
    const restore = startFileLoggingFromEnv({ EARTMP_LOG_DIR: dir });
    expect(restore).not.toBeNull();
    try {
      console.log("via env");
    } finally {
      restore?.();
    }
    expect(readFileSync(join(dir, "host.log"), "utf8")).toMatch(/via env/);
  });
});
