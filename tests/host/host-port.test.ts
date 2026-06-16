/**
 * Host port resolution + the stdout handshake the Tauri shell parses.
 */
import { describe, it, expect } from "vitest";
import {
  resolveHostPort,
  handshakeLine,
  parseHandshakeLine,
  DEV_DEFAULT_PORT,
} from "../../src/host/hostPort";

describe("resolveHostPort", () => {
  it("defaults to the dev port when unset or blank", () => {
    expect(resolveHostPort({})).toBe(DEV_DEFAULT_PORT);
    expect(resolveHostPort({ EARTMP_HOST_PORT: "" })).toBe(DEV_DEFAULT_PORT);
    expect(resolveHostPort({ EARTMP_HOST_PORT: "  " })).toBe(DEV_DEFAULT_PORT);
  });

  it("honors an explicit port, including 0 (ephemeral)", () => {
    expect(resolveHostPort({ EARTMP_HOST_PORT: "43217" })).toBe(43217);
    expect(resolveHostPort({ EARTMP_HOST_PORT: "0" })).toBe(0);
  });

  it("falls back to the dev port on garbage / out-of-range", () => {
    expect(resolveHostPort({ EARTMP_HOST_PORT: "nope" })).toBe(
      DEV_DEFAULT_PORT,
    );
    expect(resolveHostPort({ EARTMP_HOST_PORT: "-1" })).toBe(DEV_DEFAULT_PORT);
    expect(resolveHostPort({ EARTMP_HOST_PORT: "70000" })).toBe(
      DEV_DEFAULT_PORT,
    );
  });
});

describe("handshake line", () => {
  it("round-trips a bound port", () => {
    expect(parseHandshakeLine(handshakeLine(51234))).toBe(51234);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseHandshakeLine("  EARTMP_HOST_PORT=8080\n")).toBe(8080);
  });

  it("returns null for non-handshake or invalid lines", () => {
    expect(parseHandshakeLine("EARTMP host listening on …")).toBeNull();
    expect(parseHandshakeLine("EARTMP_HOST_PORT=0")).toBeNull();
    expect(parseHandshakeLine("EARTMP_HOST_PORT=abc")).toBeNull();
  });
});
