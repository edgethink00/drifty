import type { ActivityClassificationRecord, ActivitySegment } from "@drifty/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { classifyLiveActivityWithAi } = vi.hoisted(() => ({
  classifyLiveActivityWithAi: vi.fn(),
}));

vi.mock("../classification/aiClassificationService", () => ({
  classifyLiveActivityWithAi,
}));

import { evaluateYouTubeDriftAlarmGate } from "./youtubeDriftAlarmGate";

function createYouTubeVideoSegment(overrides: Partial<ActivitySegment> = {}): ActivitySegment {
  return {
    id: "youtube-video-1",
    startedAt: "2026-05-22T09:00:00.000Z",
    endedAt: "2026-05-22T09:05:00.000Z",
    durationSeconds: 300,
    appName: "Google Chrome",
    bundleId: "com.google.Chrome",
    browserName: "Google Chrome",
    siteDomain: "youtube.com",
    siteTitle: "Video",
    siteUrl: "https://www.youtube.com/watch?v=video-1",
    windowTitle: "Video",
    platform: "macos",
    source: "accessibility",
    youtubeVideoId: "video-1",
    ...overrides,
  };
}

function createAiClassification(overrides: Partial<ActivityClassificationRecord> = {}): ActivityClassificationRecord {
  return {
    segmentId: "youtube-video-1",
    inputFingerprint: "drifty-v2-test",
    category: "entertainment",
    productivity: "drift",
    source: "llm",
    confidence: 0.95,
    reason: "AI confirmed drift",
    model: "gemini-3.1-flash-lite",
    promptVersion: "v2-work-profile",
    taxonomyVersion: "v1",
    aiResult: true,
    latencyMs: 120,
    classifiedAt: "2026-05-22T09:05:00.000Z",
    ...overrides,
  };
}

describe("evaluateYouTubeDriftAlarmGate", () => {
  beforeEach(() => {
    classifyLiveActivityWithAi.mockReset();
  });

  it("allows a non-Shorts YouTube drift video when AI confirms drift", async () => {
    classifyLiveActivityWithAi.mockResolvedValue({
      kind: "classified",
      classification: createAiClassification({ productivity: "drift" }),
    });

    const result = await evaluateYouTubeDriftAlarmGate({
      segment: createYouTubeVideoSegment(),
      category: "entertainment",
    });

    expect(result).toEqual({ kind: "allow_drift", reason: "ai-confirmed-drift" });
    expect(classifyLiveActivityWithAi).toHaveBeenCalledTimes(1);
    expect(classifyLiveActivityWithAi).toHaveBeenCalledWith(expect.objectContaining({
      id: "youtube-video-1",
    }), { persistLiveResult: true });
  });

  it("suppresses a YouTube drift video when AI classifies it as focus", async () => {
    classifyLiveActivityWithAi.mockResolvedValue({
      kind: "classified",
      classification: createAiClassification({ category: "learning", productivity: "focus" }),
    });

    const result = await evaluateYouTubeDriftAlarmGate({
      segment: createYouTubeVideoSegment(),
      category: "entertainment",
    });

    expect(result).toEqual({ kind: "suppress", reason: "ai-classified-focus" });
  });

  it("suppresses a YouTube drift video when AI drift confidence is below eighty-five percent", async () => {
    classifyLiveActivityWithAi.mockResolvedValue({
      kind: "classified",
      classification: createAiClassification({ productivity: "drift", confidence: 0.8 }),
    });

    const result = await evaluateYouTubeDriftAlarmGate({
      segment: createYouTubeVideoSegment(),
      category: "entertainment",
    });

    expect(result).toEqual({ kind: "suppress", reason: "ai-low-confidence" });
  });

  it("allows a YouTube drift video when AI drift confidence is eighty-five percent", async () => {
    classifyLiveActivityWithAi.mockResolvedValue({
      kind: "classified",
      classification: createAiClassification({ productivity: "drift", confidence: 0.85 }),
    });

    const result = await evaluateYouTubeDriftAlarmGate({
      segment: createYouTubeVideoSegment(),
      category: "entertainment",
    });

    expect(result).toEqual({ kind: "allow_drift", reason: "ai-confirmed-drift" });
  });

  it("fails closed when live AI classification is unavailable", async () => {
    classifyLiveActivityWithAi.mockResolvedValue({ kind: "unavailable", reason: "provider missing" });

    const result = await evaluateYouTubeDriftAlarmGate({
      segment: createYouTubeVideoSegment(),
      category: "entertainment",
    });

    expect(result).toEqual({ kind: "suppress", reason: "ai-unavailable:provider missing" });
  });

  it("keeps a slow live AI classification pending after twelve seconds", async () => {
    vi.useFakeTimers();
    classifyLiveActivityWithAi.mockReturnValue(new Promise(() => undefined));

    try {
      const result = evaluateYouTubeDriftAlarmGate({
        segment: createYouTubeVideoSegment(),
        category: "entertainment",
      });

      await vi.advanceTimersByTimeAsync(11_999);
      await expect(Promise.race([result, Promise.resolve("pending")])).resolves.toBe("pending");

      await vi.advanceTimersByTimeAsync(1);
      const timedOut = await result;
      expect(timedOut).toEqual(expect.objectContaining({ kind: "pending", reason: "ai-timeout" }));
      if (timedOut.kind !== "pending") throw new Error("expected pending YouTube gate result");

      const settled = timedOut.settled;
      await vi.advanceTimersByTimeAsync(47_999);
      await expect(Promise.race([settled, Promise.resolve("pending")])).resolves.toBe("pending");
      await vi.advanceTimersByTimeAsync(1);
      await expect(settled).resolves.toEqual({ kind: "suppress", reason: "ai-deadline" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies a late AI drift confirmation after the twelve-second timeout", async () => {
    vi.useFakeTimers();
    let resolveClassification: ((value: { kind: "classified"; classification: ActivityClassificationRecord }) => void) | undefined;
    classifyLiveActivityWithAi.mockReturnValue(new Promise((resolve) => {
      resolveClassification = resolve;
    }));

    try {
      const result = evaluateYouTubeDriftAlarmGate({
        segment: createYouTubeVideoSegment(),
        category: "entertainment",
      });

      await vi.advanceTimersByTimeAsync(12_000);
      const timedOut = await result;
      expect(timedOut).toEqual(expect.objectContaining({ kind: "pending", reason: "ai-timeout" }));
      if (timedOut.kind !== "pending") throw new Error("expected pending YouTube gate result");

      resolveClassification?.({
        kind: "classified",
        classification: createAiClassification({ productivity: "drift" }),
      });
      await expect(timedOut.settled).resolves.toEqual({ kind: "allow_drift", reason: "ai-confirmed-drift" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an on-time AI confirmation off the pending path", async () => {
    vi.useFakeTimers();
    classifyLiveActivityWithAi.mockImplementation(() => new Promise((resolve) => {
      globalThis.setTimeout(() => {
        resolve({
          kind: "classified",
          classification: createAiClassification({ productivity: "drift" }),
        });
      }, 12_000);
    }));

    try {
      const result = evaluateYouTubeDriftAlarmGate({
        segment: createYouTubeVideoSegment(),
        category: "entertainment",
      });
      await vi.advanceTimersByTimeAsync(12_000);
      await expect(result).resolves.toEqual({ kind: "allow_drift", reason: "ai-confirmed-drift" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips Shorts without calling AI", async () => {
    const result = await evaluateYouTubeDriftAlarmGate({
      segment: createYouTubeVideoSegment({
        siteUrl: "https://www.youtube.com/shorts/shorts-1",
        youtubeVideoId: "shorts-1",
        youtubeIsShorts: true,
      }),
      category: "entertainment",
    });

    expect(result).toEqual({ kind: "skipped", reason: "youtube-shorts" });
    expect(classifyLiveActivityWithAi).not.toHaveBeenCalled();
  });

  it("skips YouTube browse pages without calling AI", async () => {
    const result = await evaluateYouTubeDriftAlarmGate({
      segment: createYouTubeVideoSegment({
        siteTitle: "YouTube",
        siteUrl: "https://www.youtube.com/",
        youtubeVideoId: null,
      }),
      category: "entertainment",
    });

    expect(result).toEqual({ kind: "skipped", reason: "youtube-browse" });
    expect(classifyLiveActivityWithAi).not.toHaveBeenCalled();
  });

  it("skips YouTube videos that deterministic category rules classify as focus", async () => {
    const result = await evaluateYouTubeDriftAlarmGate({
      segment: createYouTubeVideoSegment({ youtubeCategory: "Education" }),
      category: "learning",
    });

    expect(result).toEqual({ kind: "skipped", reason: "not-deterministic-youtube-drift" });
    expect(classifyLiveActivityWithAi).not.toHaveBeenCalled();
  });
});
