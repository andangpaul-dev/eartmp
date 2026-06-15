// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAction } from "../../src/presentation/runtime/hooks";

describe("useAction", () => {
  it("refuses re-entry while in flight (no double-submit)", async () => {
    let resolve!: () => void;
    const fn = vi.fn(() => new Promise<void>((r) => (resolve = () => r())));
    const { result } = renderHook(() => useAction(fn));

    act(() => result.current.run());
    act(() => result.current.run()); // second click while loading
    expect(fn).toHaveBeenCalledTimes(1); // re-entry guard
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolve();
    });
    await waitFor(() => expect(result.current.success).toBe(true));
    expect(result.current.error).toBeNull();
  });

  it("surfaces error and clears it on reset", async () => {
    const fn = vi.fn(async () => {
      throw new Error("boom");
    });
    const { result } = renderHook(() => useAction(fn));
    await act(async () => {
      result.current.run();
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    act(() => result.current.reset());
    expect(result.current.error).toBeNull();
    expect(result.current.success).toBe(false);
  });
});
