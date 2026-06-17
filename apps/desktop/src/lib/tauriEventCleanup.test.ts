import { describe, expect, it, vi } from "vitest";
import { cleanupTauriEventListener, isStaleTauriListenerCleanupError } from "./tauriEventCleanup";

async function flushCleanupPromise(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("tauriEventCleanup", () => {
  it("recognizes stale listener cleanup errors from Safari and Chromium", () => {
    expect(isStaleTauriListenerCleanupError(new TypeError("undefined is not an object (evaluating 'listeners[eventId].handlerId')"))).toBe(true);
    expect(isStaleTauriListenerCleanupError(new TypeError("Cannot read properties of undefined (reading 'handlerId')"))).toBe(true);
    expect(isStaleTauriListenerCleanupError(new Error("other cleanup failure"))).toBe(false);
  });

  it("swallows stale Tauri listener cleanup errors", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unlisten = vi.fn(() => {
      throw new TypeError("undefined is not an object (evaluating 'listeners[eventId].handlerId')");
    });

    cleanupTauriEventListener(unlisten);
    await flushCleanupPromise();

    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns when cleanup fails for an unrelated reason", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unlisten = vi.fn(() => {
      throw new Error("unexpected cleanup failure");
    });

    cleanupTauriEventListener(unlisten);
    await flushCleanupPromise();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});
