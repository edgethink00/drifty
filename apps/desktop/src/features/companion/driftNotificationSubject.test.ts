import { describe, expect, it } from "vitest";
import { driftNotificationSubjectFromSegment, resolveDriftNotificationSubject } from "./watcherData";
import type { ActivitySegment } from "@drifty/domain";

function segment(overrides: Partial<ActivitySegment> = {}): ActivitySegment {
  return {
    id: "segment-1",
    startedAt: "2026-09-18T03:00:00.000Z",
    endedAt: "2026-09-18T03:05:00.000Z",
    durationSeconds: 300,
    appName: "Google Chrome",
    bundleId: "com.google.Chrome",
    windowTitle: "Video",
    platform: "macos",
    source: "nsworkspace",
    ...overrides,
  } as ActivitySegment;
}

describe("drift notification subject", () => {
  it("names the site when the segment has one and the app otherwise", () => {
    expect(driftNotificationSubjectFromSegment(segment({ siteDomain: "youtube.com" }))).toEqual({
      place: "youtube.com",
      driftDurationSeconds: 300,
    });
    expect(driftNotificationSubjectFromSegment(segment())).toEqual({
      place: "Google Chrome",
      driftDurationSeconds: 300,
    });
  });

  it("keeps an explicit subject as the card-failure fallback supplies it", () => {
    // The fallback describes the alarm event, which may outlive the segment.
    expect(resolveDriftNotificationSubject({ place: "x.com", driftDurationSeconds: 80 })).toEqual({
      place: "x.com",
      driftDurationSeconds: 80,
    });
    expect(resolveDriftNotificationSubject(segment({ siteDomain: "youtube.com" }))).toEqual({
      place: "youtube.com",
      driftDurationSeconds: 300,
    });
  });
});
