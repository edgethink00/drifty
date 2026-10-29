import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivitySegment, CurrentActivitySnapshot } from "@drifty/domain";
import { recoverShortsCapture } from "./shortsCaptureRecovery";

const old: ActivitySegment = {
  id: "short-a", startedAt: "2026-10-19T00:00:00Z", endedAt: "2026-10-19T00:01:00Z", durationSeconds: 60,
  appName: "Google Chrome", bundleId: "com.google.Chrome", browserName: "Google Chrome",
  siteDomain: "youtube.com", siteUrl: "https://www.youtube.com/shorts/AAA", youtubeVideoId: "AAA",
  platform: "macos", source: "accessibility",
};
const snapshot: CurrentActivitySnapshot = {
  ...old, observedAt: "2026-10-19T00:01:02Z", siteUrl: "https://www.youtube.com/shorts/BBB", youtubeVideoId: "BBB",
};

afterEach(() => vi.useRealTimers());

describe("Shorts capture recovery", () => {
  it("waits for an actual row without copying the old verdict", async () => {
    vi.useFakeTimers();
    const next = { ...old, id: "short-b", siteUrl: snapshot.siteUrl, youtubeVideoId: "BBB",
      startedAt: old.endedAt, endedAt: snapshot.observedAt, durationSeconds: 2,
      classification: { category: "learning", productivity: "focus", source: "manual", confidence: 1 } } as const;
    const refresh = vi.fn().mockResolvedValueOnce({ segments: [old], snapshot })
      .mockResolvedValue({ segments: [old, next], snapshot });
    const result = recoverShortsCapture({ context: { segments: [old], snapshot }, refresh, isCurrent: () => true });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await result).toEqual({ segments: [old, next], snapshot });
    expect(old.classification).toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("bounds a permanently missing row and preserves the mismatch", async () => {
    vi.useFakeTimers();
    const context = { segments: [old], snapshot };
    const refresh = vi.fn().mockResolvedValue(context);
    const result = recoverShortsCapture({ context, refresh, isCurrent: () => true });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await result).toBe(context);
    expect(refresh).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers an unavailable native Chrome snapshot using an actual fresh page", async () => {
    vi.useFakeTimers();
    const unavailable: CurrentActivitySnapshot = { observedAt: snapshot.observedAt,
      appName: old.appName, bundleId: old.bundleId, browserName: old.browserName,
      source: "nsworkspace", frontmostCaptureSource: "nsworkspace", browserAutomationStatus: "unavailable" };
    const restored = { segments: [old], snapshot: { ...snapshot, siteUrl: old.siteUrl, youtubeVideoId: "AAA" } };
    const refresh = vi.fn().mockResolvedValue(restored);
    const result = recoverShortsCapture({ context: { segments: [old], snapshot: unavailable }, refresh, isCurrent: () => true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toEqual(restored);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not start another observation after a slow read consumes the retry window", async () => {
    vi.useFakeTimers();
    const context = { segments: [old], snapshot };
    const refresh = vi.fn(async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 4_500));
      return context;
    });
    const result = recoverShortsCapture({ context, refresh, isCurrent: () => true });
    await vi.advanceTimersByTimeAsync(6_500);
    expect(refresh).toHaveBeenCalledOnce();
    expect(await result).toBe(context);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the retry window bounded when the system clock moves backward", async () => {
    vi.useFakeTimers();
    const context = { segments: [old], snapshot };
    const refresh = vi.fn().mockResolvedValue(context);
    const result = recoverShortsCapture({ context, refresh, isCurrent: () => true });
    await vi.advanceTimersByTimeAsync(1_000);
    vi.setSystemTime(Date.now() - 60_000);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(refresh).toHaveBeenCalledTimes(6);
    expect(await result).toBe(context);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds permanently unavailable native context without inventing its page", async () => {
    vi.useFakeTimers();
    const unavailable: CurrentActivitySnapshot = { observedAt: snapshot.observedAt,
      appName: old.appName, bundleId: old.bundleId, browserName: old.browserName,
      source: "nsworkspace", frontmostCaptureSource: "nsworkspace", browserAutomationStatus: "unavailable" };
    const context = { segments: [old], snapshot: unavailable };
    const refresh = vi.fn().mockResolvedValue(context);
    const result = recoverShortsCapture({ context, refresh, isCurrent: () => true });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await result).toBe(context);
    expect(refresh).toHaveBeenCalledTimes(6);
    expect((await result).snapshot?.siteUrl).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { source: "accessibility" as const },
    { frontmostCaptureSource: "system-events" as const },
    { browserAutomationStatus: "denied" as const },
    { windowTitle: "Different page" },
    { siteUrl: "https://www.youtube.com/watch?v=BBB" },
    { appName: "Safari", bundleId: "com.apple.Safari", browserName: "Safari" },
    { observedAt: "2026-10-19T00:02:00Z" },
  ])("does not broaden native recovery to denied, stale or observed other contexts: %j", async patch => {
    const unavailable: CurrentActivitySnapshot = { observedAt: snapshot.observedAt,
      appName: old.appName, bundleId: old.bundleId, browserName: old.browserName,
      source: "nsworkspace", frontmostCaptureSource: "nsworkspace", browserAutomationStatus: "unavailable", ...patch };
    const context = { segments: [old], snapshot: unavailable };
    const refresh = vi.fn();
    expect(await recoverShortsCapture({ context, refresh, isCurrent: () => true })).toBe(context);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not refresh after cancellation while waiting", async () => {
    vi.useFakeTimers();
    let current = true;
    const refresh = vi.fn();
    const context = { segments: [old], snapshot };
    const result = recoverShortsCapture({ context, refresh, isCurrent: () => current });
    current = false;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toBe(context);
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([
    { ...snapshot, bundleId: "com.apple.Safari", appName: "Safari" },
    { ...snapshot, siteUrl: "https://www.youtube.com/watch?v=BBB", youtubeIsShorts: true },
    { ...snapshot, siteDomain: "example.com" },
    { ...snapshot, siteUrl: "https://example.com/shorts/BBB" },
    { ...snapshot, observedAt: "2026-10-19T00:02:00Z" },
    { ...snapshot, observedAt: "invalid" },
    { ...snapshot, systemTransientActivity: "spotlight" as const },
  ])("leaves a different or unverified context to the ordinary safety gates: %j", async current => {
    const refresh = vi.fn();
    const context = { segments: [old], snapshot: current };
    expect(await recoverShortsCapture({ context, refresh, isCurrent: () => true })).toBe(context);
    expect(refresh).not.toHaveBeenCalled();
  });
});
