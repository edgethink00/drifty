import type { ActivitySegment } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import {
  DRIFT_ALARM_DEBUG_LOG_STORAGE_KEY,
  readRecentDriftAlarmDebugEvents,
  recordDriftAlarmDebugEvent,
  summarizeDriftAlarmCandidate,
  summarizeDriftAlarmSegment,
} from "./driftAlarmDebugLog";
import type { DriftAlarmCandidate } from "./driftAlarmData";

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();

  get length(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.items.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

function segment(overrides: Partial<ActivitySegment> = {}): ActivitySegment {
  return {
    id: "segment-1",
    startedAt: "2026-06-13T15:00:00.000Z",
    endedAt: "2026-06-13T15:05:00.000Z",
    durationSeconds: 300,
    appName: "Google Chrome",
    browserName: "Google Chrome",
    platform: "macos",
    source: "accessibility",
    ...overrides,
  };
}

describe("drift alarm debug log", () => {
  it("records the YouTube path shape and shorts flag a classification depends on", () => {
    // A Shorts session that reaches the classifier without `youtubeIsShorts`
    // is graded as a plain video, so the export must show whether the signal
    // survived capture and which URL shape produced it.
    const shorts = summarizeDriftAlarmSegment(segment({
      siteDomain: "youtube.com",
      siteUrl: "https://www.youtube.com/shorts/ShortQA0001",
      youtubeVideoId: "ShortQA0001",
      youtubeIsShorts: true,
    }));
    expect(shorts.youtubeUrlPathKind).toBe("shorts");
    expect(shorts.youtubeIsShorts).toBe(true);

    const watch = summarizeDriftAlarmSegment(segment({
      siteDomain: "youtube.com",
      siteUrl: "https://www.youtube.com/watch?v=ShortQA0001",
      youtubeVideoId: "ShortQA0001",
      youtubeIsShorts: false,
    }));
    expect(watch.youtubeUrlPathKind).toBe("watch");
    expect(watch.youtubeIsShorts).toBe(false);
  });

  it("separates a missing YouTube URL from a non-YouTube surface", () => {
    // This is the exact ambiguity that blocked the Shorts diagnosis: the
    // export showed a youtube.com domain but no way to tell whether the URL
    // was never captured.
    const missingUrl = summarizeDriftAlarmSegment(segment({
      siteDomain: "youtube.com",
      youtubeVideoId: "ShortQA0001",
    }));
    expect(missingUrl.youtubeUrlPathKind).toBe("missing_url");
    expect(missingUrl.youtubeIsShorts).toBeNull();

    const other = summarizeDriftAlarmSegment(segment({
      siteDomain: "example.com",
      siteUrl: "https://example.com/watch",
    }));
    expect(other.youtubeUrlPathKind).toBe("not_youtube");
  });

  it("never puts a raw browsing URL into the exported summary", () => {
    // The debug log is user-exportable, so the privacy boundary requires the
    // path shape rather than the URL itself.
    const summary = summarizeDriftAlarmSegment(segment({
      siteDomain: "youtube.com",
      siteUrl: "https://www.youtube.com/shorts/ShortQA0001?feature=share",
    }));
    expect(JSON.stringify(summary)).not.toContain("feature=share");
    expect(JSON.stringify(summary)).not.toContain("https://");
  });

  it("redacts raw and encoded URLs from diagnostic text before storage", () => {
    const storage = new MemoryStorage();
    const now = new Date("2026-06-13T15:06:00.000Z");

    recordDriftAlarmDebugEvent({
      kind: "extreme_nudge_error",
      reason: "browser_tab_not_found",
      message: "Failed https://example.com/reset?token=secret, https%3A%2F%2Fexample.com%2Fprivate%3Fkey%3Dhidden, file%3A%2F%2FUsers%2Fprivate%2Fsecret.txt, https:%2F%2Fexample.com%2Fmixed%3Fsecret%3Dyes, drifty://private/path, and https%253A%252F%252Fexample.com%252Fdouble%253Fsecret%253Dyes",
    }, storage, now);

    const serialized = storage.getItem(DRIFT_ALARM_DEBUG_LOG_STORAGE_KEY) ?? "";
    expect(serialized).toContain("browser_tab_not_found");
    expect(serialized).toContain("[redacted-url]");
    expect(serialized).not.toContain("token=secret");
    expect(serialized).not.toContain("key%3Dhidden");
    expect(serialized).not.toContain("secret.txt");
    expect(serialized).not.toContain("secret%3Dyes");
    expect(serialized).not.toContain("private/path");
    expect(serialized).not.toContain("double%253Fsecret");
    expect(serialized).not.toContain("https://");
    expect(serialized.toLowerCase()).not.toContain("https%3a%2f%2f");
  });

  it("keeps only the recent five minute alarm diagnostics", () => {
    const storage = new MemoryStorage();
    const oldDate = new Date("2026-06-13T15:00:00.000Z");
    const recentDate = new Date("2026-06-13T15:06:00.000Z");

    recordDriftAlarmDebugEvent({
      kind: "candidate_missing",
      recordedAt: oldDate.toISOString(),
      reason: "old",
    }, storage, oldDate);
    recordDriftAlarmDebugEvent({
      kind: "fresh_candidate_result",
      recordedAt: recentDate.toISOString(),
      result: "current-window-changed",
    }, storage, recentDate);

    const events = readRecentDriftAlarmDebugEvents(storage, recentDate.getTime());

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "fresh_candidate_result",
      result: "current-window-changed",
    });
  });

  it("summarizes drift candidates without raw titles or URLs", () => {
    const candidate: DriftAlarmCandidate = {
      alertKey: "segment-1:2026-06-13T15:05:00.000Z",
      category: "entertainment",
      classification: {
        category: "entertainment",
        productivity: "drift",
        confidence: 0.95,
        source: "llm",
        surface: "browser",
        reason: "Sensitive AI reason",
      },
      sourceSegmentId: "raw-segment-1",
      segment: segment({
        siteDomain: "youtube.com",
        siteTitle: "Sensitive video title",
        siteUrl: "https://www.youtube.com/watch?v=sensitive-video",
        windowTitle: "Sensitive window title",
        youtubeVideoId: "sensitive-video",
        youtubeTitle: "Sensitive YouTube metadata title",
        browserAutomationStatus: "granted",
        browserAutomationError: "Sensitive automation error",
        classification: {
          category: "entertainment",
          productivity: "drift",
          confidence: 0.95,
          source: "llm",
          reason: "Sensitive AI reason",
        },
      }),
    };

    const summary = summarizeDriftAlarmCandidate(candidate);
    const serialized = JSON.stringify(summary);

    expect(summary.segment).toMatchObject({
      id: "segment-1",
      siteDomain: "youtube.com",
      youtubeVideoId: "sensitive-video",
      hasBrowserAutomationError: true,
    });
    expect(serialized).not.toContain("Sensitive video title");
    expect(serialized).not.toContain("Sensitive window title");
    expect(serialized).not.toContain("https://www.youtube.com");
    expect(serialized).not.toContain("Sensitive AI reason");
    expect(serialized).not.toContain("Sensitive automation error");
  });

  it("ignores malformed stored diagnostics", () => {
    const storage = new MemoryStorage();
    storage.setItem(DRIFT_ALARM_DEBUG_LOG_STORAGE_KEY, JSON.stringify([{ kind: "fresh_candidate_result" }]));

    const events = readRecentDriftAlarmDebugEvents(storage, new Date("2026-06-13T15:06:00.000Z").getTime());

    expect(events).toEqual([]);
    expect(summarizeDriftAlarmSegment(segment()).hasSiteContext).toBe(false);
  });

  it("stores candidate missing probe details", () => {
    const storage = new MemoryStorage();
    const now = new Date("2026-06-13T15:06:00.000Z");

    recordDriftAlarmDebugEvent({
      kind: "candidate_missing",
      candidateProbe: {
        reason: "current_snapshot_mismatch",
        latestSegment: summarizeDriftAlarmSegment(segment({ appName: "Figma" })),
        activeSegment: null,
        identityMatched: false,
        candidateDurationSeconds: null,
        minimumDurationSeconds: 60,
        classification: null,
        liveAiAvailable: true,
        systemTransientActivity: null,
      },
    }, storage, now);

    expect(readRecentDriftAlarmDebugEvents(storage, now.getTime())[0]?.candidateProbe).toMatchObject({
      reason: "current_snapshot_mismatch",
      identityMatched: false,
      minimumDurationSeconds: 60,
    });
  });
});
