import { expect, it } from "vitest";
import type { ActivitySegment } from "./activity";
import { classifyActivity, buildProductivityDurations } from "./aggregation";
import { aggregateDeviceElapsedTime, clipDeviceElapsedTimeSegment } from "./deviceElapsedTime";
import { buildPersonalProjectSliceProjection } from "./projectWindowAssignments";
import { classifySocialActivity } from "./socialClassification";
import { classifyYouTubeActivity } from "./youtubeClassification";

function feed(youtube: boolean, seconds = 40): ActivitySegment {
  return { id: "feed", startedAt: "2026-04-06T09:02:40Z", endedAt: new Date(Date.parse("2026-04-06T09:02:40Z") + seconds * 1000).toISOString(), durationSeconds: seconds,
    appName: "Chrome", browserName: "Chrome", siteDomain: youtube ? "youtube.com" : "x.com", siteUrl: youtube ? "https://www.youtube.com/feed/subscriptions" : "https://x.com/home", platform: "macos", source: "accessibility" };
}
it.each([false, true])("keeps captured feed classification when devices split 40 seconds into 20 (youtube=%s)", youtube => {
  const original = feed(youtube);
  const records = [original, { ...original, id: "code", appName: "Code", browserName: null, siteDomain: null, siteUrl: null, deviceId: "pc", platform: "windows" }];
  const serialized = JSON.stringify(records);
  expect(classifyActivity(original).productivity).toBe("drift");
  const derived = aggregateDeviceElapsedTime(records);
  expect(derived.map(s => s.durationSeconds)).toEqual([20, 20]);
  expect(classifyActivity(derived[0]).productivity).toBe("drift");
  expect((youtube ? classifyYouTubeActivity(derived[0]) : classifySocialActivity(derived[0]))?.productivity).toBe("drift");
  expect(buildProductivityDurations(records).map(s => [s.productivity, s.totalSeconds])).toEqual([["focus", 20], ["neutral", 0], ["drift", 20]]);
  expect(JSON.stringify(records)).toBe(serialized);
  const clipped = clipDeviceElapsedTimeSegment({ ...derived[0], endedAt: "2026-04-06T09:03:00Z" });
  expect(clipped.durationSeconds).toBe(10);
  expect(classifyActivity(aggregateDeviceElapsedTime([clipped])[0]).productivity).toBe("drift");
});
it.each([false, true])("preserves captured duration evidence on virtual project slices (youtube=%s)", youtube => {
  const original = feed(youtube);
  const windows = [0, 3].map(minute => ({
    windowId: "w" + minute, windowStartedAt: new Date(Date.parse("2026-04-06T09:00:00Z") + minute * 60000).toISOString(),
    windowEndedAt: new Date(Date.parse("2026-04-06T09:00:00Z") + (minute + 3) * 60000).toISOString(),
    durationSeconds: 20, segmentOverlaps: [{segmentId: original.id, durationSeconds: 20}], projectId: null, teamProjectId: null, source: "ai" as const,
  }));
  const slices = buildPersonalProjectSliceProjection([original], windows, []).segments;
  expect(slices.map(s => s.durationSeconds)).toEqual([20, 20]);
  expect(slices.map(s => classifyActivity(s).productivity)).toEqual(["drift", "drift"]);
});
it.each([false, true])("keeps genuinely short feeds unknown and preserves manual/rule priority (youtube=%s)", youtube => {
  const original = feed(youtube, 20);
  const derived = aggregateDeviceElapsedTime([original, {...original, id: "b", deviceId: "pc"}])[0];
  expect(classifyActivity(derived).category).toBe("unknown");
  expect(classifyActivity({...derived, classification: {category: "learning", productivity: "focus", source: "manual", confidence: 1}}).productivity).toBe("focus");
  expect(classifyActivity(derived, {rules: [{targetKind: "site", targetValue: original.siteDomain!, category: "learning", productivity: "focus"}]}).productivity).toBe("focus");
});
