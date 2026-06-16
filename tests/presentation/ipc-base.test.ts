// @vitest-environment jsdom
/**
 * The ipc client resolves its API base per call, preferring the base the Tauri
 * shell injects (ephemeral port) over the build-time fallback.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ipcClient } from "../../src/presentation/runtime/ipcClient";

function mockFetchOk(): ReturnType<typeof vi.fn> {
  const fetch = vi.fn(async () => ({
    json: async () => ({ ok: true, data: { locked: false, required: true } }),
  }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as { __EARTMP_API_BASE__?: unknown }).__EARTMP_API_BASE__;
});

describe("ipc API base resolution", () => {
  beforeEach(() => {
    delete (window as { __EARTMP_API_BASE__?: unknown }).__EARTMP_API_BASE__;
  });

  it("uses the injected base when the shell provides one", async () => {
    (window as { __EARTMP_API_BASE__?: string }).__EARTMP_API_BASE__ =
      "http://127.0.0.1:43217/api";
    const fetch = mockFetchOk();
    await ipcClient.lockState();
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:43217/api/lock-state");
  });

  it("falls back to /api when nothing is injected (dev proxy)", async () => {
    const fetch = mockFetchOk();
    await ipcClient.lockState();
    expect(fetch).toHaveBeenCalledWith("/api/lock-state");
  });

  it("ignores a non-string injected value", async () => {
    (window as { __EARTMP_API_BASE__?: unknown }).__EARTMP_API_BASE__ = 1234;
    const fetch = mockFetchOk();
    await ipcClient.lockState();
    expect(fetch).toHaveBeenCalledWith("/api/lock-state");
  });
});
