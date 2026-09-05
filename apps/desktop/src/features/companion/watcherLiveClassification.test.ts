import type { ActivitySegment, CurrentActivitySnapshot } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import { buildLiveWatcherSnapshot, buildWatcherSnapshotFromCurrent } from "./watcherData";
import { buildDriftAlarmCandidates } from "./driftAlarmData";
import { buildPetModeSnapshot } from "../pet-mode/petModeData";
import { advancePetModeDriftHunt, EMPTY_PET_MODE_DRIFT_HUNT_STATE } from "../pet-mode/petModeDriftHunt";

const current: CurrentActivitySnapshot = {
  observedAt: "2026-09-05T18:32:15.000Z",
  appName: "Aside",
  bundleId: "at.studio.AsideBrowser",
  browserName: "Aside",
  siteDomain: "youtube.com",
  siteUrl: "https://www.youtube.com/watch?v=AbCdEf12345",
  youtubeVideoId: "AbCdEf12345",
  youtubeIsShorts: false,
  windowTitle: "Computer review - YouTube",
  siteTitle: "Computer review",
  source: "accessibility",
};

function active(overrides: Partial<ActivitySegment> = {}): ActivitySegment {
  return {
    ...current,
    id: "current-video-segment",
    startedAt: "2026-09-05T18:30:15.000Z",
    endedAt: current.observedAt,
    durationSeconds: 120,
    platform: "macos",
    classification: { category: "learning", productivity: "focus", confidence: 0.85, source: "llm", aiResult: true },
    ...overrides,
  };
}

describe("live pet classification", () => {
  it.each(["focus", "neutral"] as const)("shares the active video's AI %s verdict with the alarm and stops cursor hunting", (productivity) => {
    const segment = active({ classification: { category: "learning", productivity, confidence: 0.7, source: "llm", aiResult: true } });
    const snapshot = buildLiveWatcherSnapshot(current, [segment]);
    expect(snapshot).toMatchObject({ category: "learning", productivity, durationSeconds: 120 });
    expect(snapshot.focusStrikeSeconds).toBe(productivity === "focus" ? 120 : null);
    expect(buildDriftAlarmCandidates({ segments: [segment], currentSnapshot: current, classificationOptions: {}, minimumDurationSeconds: 60 })).toEqual([]);
    expect(advancePetModeDriftHunt(EMPTY_PET_MODE_DRIFT_HUNT_STATE, buildPetModeSnapshot(snapshot), false).action).toBeNull();
  });

  it("keeps confirmed drift eligible for cursor hunting", () => {
    const segment = active({ classification: { category: "entertainment", productivity: "drift", confidence: 0.95, source: "llm", aiResult: true } });
    const snapshot = buildLiveWatcherSnapshot(current, [segment]);
    expect(snapshot.productivity).toBe("drift");
    expect(advancePetModeDriftHunt(EMPTY_PET_MODE_DRIFT_HUNT_STATE, buildPetModeSnapshot(snapshot), false).action).toBe("stalk");
  });

  it("applies live user rules ahead of AI and manual corrections ahead of rules", () => {
    const options = { rules: [{ targetKind: "site" as const, targetValue: "youtube.com", category: "entertainment" as const, productivity: "drift" as const }] };
    expect(buildLiveWatcherSnapshot(current, [active()], options).productivity).toBe("drift");
    const manual = active({ classification: { category: "learning", productivity: "focus", confidence: 1, source: "manual" } });
    expect(buildLiveWatcherSnapshot(current, [manual], options).productivity).toBe("focus");
  });

  it("honors disabled AI impact and ignores stale AI results", () => {
    expect(buildLiveWatcherSnapshot(current, [active()], { includeAiClassifications: false }).productivity).toBe("drift");
    const stale = active({ classification: { ...active().classification!, stale: true } });
    expect(buildLiveWatcherSnapshot(current, [stale]).productivity).toBe("drift");
  });

  it("retains the active video's captured metadata", () => {
    expect(buildLiveWatcherSnapshot(current, [active({ classification: null, youtubeCategory: "Science & Technology" })])).toMatchObject({ category: "learning", productivity: "focus" });
  });

  it("matches video IDs from URLs without confusing a playback position change for a new video", () => {
    expect(buildLiveWatcherSnapshot({ ...current, youtubeVideoId: null, siteUrl: current.siteUrl + "&t=42" }, [active({ youtubeVideoId: null })]).productivity).toBe("focus");
  });

  it.each([
    { label: "different video", patch: { youtubeVideoId: "ZbCdEf12345", siteUrl: "https://www.youtube.com/watch?v=ZbCdEf12345" } },
    { label: "case-distinct video", patch: { youtubeVideoId: "abCdEf12345", siteUrl: "https://www.youtube.com/watch?v=abCdEf12345" } },
    { label: "conflicting URL and video ID", patch: { siteUrl: "https://www.youtube.com/watch?v=ZbCdEf12345" } },
    { label: "feed with a stale video ID", patch: { siteUrl: "https://www.youtube.com/feed/subscriptions" } },
    { label: "ID-less watch URL with a stale video ID", patch: { siteUrl: "https://www.youtube.com/watch" } },
    { label: "missing video identity", patch: { youtubeVideoId: null, siteUrl: "https://www.youtube.com/watch" } },
    { label: "different browser", patch: { browserName: "Google Chrome", appName: "Google Chrome", bundleId: "com.google.Chrome" } },
  ])("does not inherit verdict or elapsed time for $label", ({ patch }) => {
    const snapshot = buildLiveWatcherSnapshot({ ...current, ...patch }, [active()]);
    expect(snapshot.productivity).not.toBe("focus");
    expect(snapshot.durationSeconds).toBe(0);
  });

  it("does not search older same-video segments when the newest segment is unclassified", () => {
    const old = active({ id: "old", endedAt: "2026-09-05T18:31:59.000Z" });
    const newest = active({ id: "new", classification: null, startedAt: "2026-09-05T18:32:00.000Z", durationSeconds: 15 });
    expect(buildLiveWatcherSnapshot(current, [old, newest])).toMatchObject({ productivity: "drift", durationSeconds: 15 });
  });

  it.each([
    { label: "old history", patch: { endedAt: "2026-09-05T18:30:00.000Z" } },
    { label: "future observation", patch: { endedAt: "2026-09-05T18:32:20.000Z" } },
    { label: "remote device", patch: { deviceId: "other-device" } },
    { label: "browser history import", patch: { source: "browser-history-import" as const } },
  ])("does not inherit $label", ({ patch }) => {
    expect(buildLiveWatcherSnapshot(current, [active(patch)])).toMatchObject({ productivity: "drift", durationSeconds: 0 });
  });

  it("does not transfer a native app verdict between differently titled windows", () => {
    const appCurrent = { ...current, appName: "Example", bundleId: "test.example", browserName: null, siteDomain: null, siteUrl: null, youtubeVideoId: null, windowTitle: "Window B" };
    const segment = active({ ...appCurrent, windowTitle: "Window A" });
    expect(buildLiveWatcherSnapshot(appCurrent, [segment]).productivity).not.toBe("focus");
    expect(buildLiveWatcherSnapshot({ ...appCurrent, windowTitle: "Window A" }, [segment]).productivity).toBe("focus");
  });

  it("uses the later start to break equal-end ties, and rejects fully ambiguous rows", () => {
    const old = active({ id: "old", startedAt: "2026-09-05T18:30:00.000Z" });
    const newest = active({ id: "new", classification: null });
    for (const segments of [[old, newest], [newest, old]]) {
      expect(buildLiveWatcherSnapshot(current, segments).productivity).toBe("drift");
    }
    const ambiguous = active({ id: "other", classification: null });
    expect(buildLiveWatcherSnapshot(current, [active(), ambiguous]).durationSeconds).toBe(0);
  });

  it("does not identify an uncaptured native window by its app name alone", () => {
    const appCurrent = { ...current, appName: "Example", bundleId: "test.example", browserName: null, siteDomain: null, siteUrl: null, siteTitle: null, youtubeVideoId: null, windowTitle: null };
    expect(buildLiveWatcherSnapshot(appCurrent, [active(appCurrent)])).toMatchObject({ durationSeconds: 0 });
    expect(buildLiveWatcherSnapshot(appCurrent, [active(appCurrent)]).productivity).not.toBe("focus");
  });

  it("ignores malformed timestamps without hiding a valid current row", () => {
    expect(buildLiveWatcherSnapshot(current, [active({ id: "invalid", endedAt: "invalid" }), active()]).productivity).toBe("focus");
  });
});

describe("live watcher focus runs", () => {
  function priorFocus(): ActivitySegment {
    return active({
      id: "prior-focus-app",
      startedAt: "2026-09-05T18:28:15.000Z",
      endedAt: "2026-09-05T18:30:15.000Z",
      appName: "Code",
      bundleId: "com.microsoft.VSCode",
      browserName: null,
      siteDomain: null,
      siteUrl: null,
      siteTitle: null,
      windowTitle: "Project",
      youtubeVideoId: null,
      youtubeIsShorts: false,
    });
  }

  it.each([0, 15])("counts a continuous focus run across apps once with %i uncaptured seconds", (uncapturedSeconds) => {
    const observed = { ...current, observedAt: new Date(Date.parse(current.observedAt) + uncapturedSeconds * 1_000).toISOString() };
    const segments = [priorFocus(), active()];
    const original = structuredClone(segments);

    expect(buildLiveWatcherSnapshot(observed, segments)).toMatchObject({
      productivity: "focus",
      durationSeconds: 120 + uncapturedSeconds,
      focusStrikeSeconds: 240 + uncapturedSeconds,
      preservedFocusStrikeSeconds: null,
      focusSecondsToday: 240 + uncapturedSeconds,
    });
    expect(segments).toEqual(original);
  });

  it.each([0, 15])("preserves the preceding focus run without adding %i uncaptured drift seconds", (uncapturedSeconds) => {
    const observed = { ...current, observedAt: new Date(Date.parse(current.observedAt) + uncapturedSeconds * 1_000).toISOString() };
    const drift = active({ classification: { category: "entertainment", productivity: "drift", confidence: 0.95, source: "llm", aiResult: true } });

    expect(buildLiveWatcherSnapshot(observed, [priorFocus(), drift])).toMatchObject({
      productivity: "drift",
      durationSeconds: 120 + uncapturedSeconds,
      focusStrikeSeconds: null,
      preservedFocusStrikeSeconds: 120,
      focusSecondsToday: 120,
    });
  });

  it("ends the earlier focus run at an intervening neutral activity", () => {
    const prior = priorFocus();
    const neutral = active({
      id: "neutral-break",
      startedAt: prior.endedAt,
      endedAt: "2026-09-05T18:30:45.000Z",
      durationSeconds: 30,
      classification: { category: "learning", productivity: "neutral", confidence: 0.7, source: "llm", aiResult: true },
    });
    const latest = active({ startedAt: neutral.endedAt, durationSeconds: 90 });

    expect(buildLiveWatcherSnapshot(current, [prior, neutral, latest])).toMatchObject({
      focusStrikeSeconds: 90,
      focusSecondsToday: 210,
    });
  });

  it("keeps the original synthetic-current builder's focus run calculation", () => {
    const rules = [{ targetKind: "site" as const, targetValue: "youtube.com", category: "learning" as const, productivity: "focus" as const }];
    expect(buildWatcherSnapshotFromCurrent(current, [priorFocus(), active()], null, { rules })).toMatchObject({
      focusStrikeSeconds: 240,
      focusSecondsToday: 240,
    });
  });
});
