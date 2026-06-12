import { describe, it, expect } from "vitest";
import {
  JsonLogger,
  redact,
} from "../../src/infrastructure/observability/JsonLogger";

describe("redact / JsonLogger", () => {
  it("redacts secret-ish keys, recursively", () => {
    const out = redact({
      user: "admin",
      passphrase: "hunter2",
      nested: { privateKey: "PEM", ok: 1 },
    });
    expect(out).toMatchObject({
      user: "admin",
      passphrase: "[REDACTED]",
      nested: { privateKey: "[REDACTED]", ok: 1 },
    });
  });

  it("emits one redacted JSON line per call", () => {
    const lines: string[] = [];
    const log = new JsonLogger((l) => lines.push(l));
    log.info("signed transcript", {
      transcriptNumber: "TR-1",
      signature: "abc123",
      token: "xyz",
    });
    const parsed = JSON.parse(lines[0]!) as {
      level: string;
      message: string;
      context: Record<string, unknown>;
    };
    expect(parsed.level).toBe("info");
    expect(parsed.context.transcriptNumber).toBe("TR-1");
    expect(parsed.context.signature).toBe("[REDACTED]");
    expect(parsed.context.token).toBe("[REDACTED]");
    expect(lines[0]).not.toContain("abc123");
  });

  it("supports warn and error levels", () => {
    const lines: string[] = [];
    const log = new JsonLogger((l) => lines.push(l));
    log.warn("careful");
    log.error("boom");
    expect(JSON.parse(lines[0]!).level).toBe("warn");
    expect(JSON.parse(lines[1]!).level).toBe("error");
  });
});
