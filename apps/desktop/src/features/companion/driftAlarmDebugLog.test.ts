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
});
