import type { ActivitySegment, CurrentActivitySnapshot } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import {
  buildLiveWatcherSnapshot,
  buildWatcherSnapshot,
  buildWatcherSnapshotFromCurrent,
  shouldReplacePetModeLiveSnapshot,
  snapshotObservedAtMs,
} from "./watcherData";

const historicalFocus: ActivitySegment = {
  id: "19610",
  startedAt: "2026-08-29T10:00:00.000Z",
  endedAt: "2026-08-29T10:20:00.000Z",
  durationSeconds: 1200,
  appName: "ChatGPT",
  bundleId: "com.openai.codex",
  windowTitle: "Codex",
  platform: "macos",
  source: "nsworkspace",
};

const liveYouTube: CurrentActivitySnapshot = {
  observedAt: "2026-08-30T19:06:13.000Z",
  appName: "Aside",
  bundleId: "at.studio.AsideBrowser",
  browserName: "Aside",
  siteDomain: "youtube.com",
  siteUrl: "https://www.youtube.com/watch?v=WatchQA0001",
  youtubeVideoId: "WatchQA0001",
  youtubeIsShorts: false,
  siteSource: "applescript",
  source: "nsworkspace",
};

describe("buildLiveWatcherSnapshot", () => {
  it("classifies a live YouTube drift even when the dashboard day ended in focus", () => {
    const dashboardDay = buildWatcherSnapshot([historicalFocus]);
    const reusedCompanion = buildWatcherSnapshotFromCurrent(liveYouTube, [historicalFocus], null, {
      fallbackCandidates: [historicalFocus],
    });
    const live = buildLiveWatcherSnapshot(liveYouTube, [historicalFocus]);

    expect(dashboardDay.productivity).toBe("focus");
    expect(reusedCompanion.productivity).toBe("drift");
    expect(live).toMatchObject({
      productivity: "drift",
      category: "entertainment",
      contextLabel: "youtube.com",
    });
  });

  it("keeps a live Codex session seated as focus", () => {
    const liveCodex: CurrentActivitySnapshot = {
      observedAt: "2026-08-30T19:06:13.000Z",
      appName: "ChatGPT",
      bundleId: "com.openai.codex",
      source: "nsworkspace",
    };

    expect(buildLiveWatcherSnapshot(liveCodex, [historicalFocus])).toMatchObject({
      productivity: "focus",
      category: "workspace",
    });
  });
});

describe("pet live snapshot freshness", () => {
  it("keeps a newer alarm snapshot ahead of a stale React currentSnapshot", () => {
    const alarmObservedAt = snapshotObservedAtMs(liveYouTube);
    const staleReactSnapshot = snapshotObservedAtMs({
      observedAt: "2026-08-30T19:04:49.000Z",
    });

    expect(alarmObservedAt).toBe(Date.parse("2026-08-30T19:06:13.000Z"));
    expect(shouldReplacePetModeLiveSnapshot(alarmObservedAt, 0)).toBe(true);
    expect(shouldReplacePetModeLiveSnapshot(staleReactSnapshot, alarmObservedAt ?? 0)).toBe(false);
    expect(shouldReplacePetModeLiveSnapshot(null, 1)).toBe(false);
  });
});
