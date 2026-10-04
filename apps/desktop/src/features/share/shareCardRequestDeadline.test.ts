// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { shareCardRequestDeadline } from "./shareCardRequestDeadline";
afterEach(() => vi.useRealTimers());
it("settles once at the deadline and does not replace the fallback with a late result", async () => {
  vi.useFakeTimers();
  let finish!: (value: string) => void;
  const pending = new Promise<string>((resolve) => { finish = resolve; });
  const result = shareCardRequestDeadline(pending, "unavailable");
  await vi.advanceTimersByTimeAsync(5_000);
  expect(await result).toBe("unavailable");
  finish("late rank");
  await Promise.resolve();
  expect(await result).toBe("unavailable");
  expect(vi.getTimerCount()).toBe(0);
});
it("clears its deadline after success or failure", async () => {
  vi.useFakeTimers();
  expect(await shareCardRequestDeadline(Promise.resolve("rank"), "unavailable")).toBe("rank");
  expect(await shareCardRequestDeadline(Promise.reject(new Error("offline")), "unavailable")).toBe("unavailable");
  expect(vi.getTimerCount()).toBe(0);
});
