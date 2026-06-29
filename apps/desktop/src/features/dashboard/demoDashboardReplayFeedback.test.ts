import { describe, expect, it } from "vitest";
import {
  buildDemoDashboardReplayAnchor,
  buildDemoDashboardReplayFixture,
  sliceDemoDashboardReplaySegments,
} from "./demoDashboardReplay";
import { resolveDemoDashboardReplayProgressIntervalMs } from "./useDashboardDemoReplayController";

describe("demo dashboard replay feedback fixes", () => {
  it("Given a four-am logical day When replay is sliced Then the marker uses the last revealed wall-clock minute", () => {
    const anchor = buildDemoDashboardReplayAnchor({
      kind: "day",
      currentLogicalDay: "2026-06-18",
      startOfDayMinutes: 4 * 60,
      startOfWeek: "monday",
    });
    const fixture = buildDemoDashboardReplayFixture(anchor);
    const progressAtOneThirty = (9 * 60 + 30) / (24 * 60);

    const slice = sliceDemoDashboardReplaySegments({ anchor, progress: progressAtOneThirty, segments: fixture.segments });

    expect(slice.virtualCurrentDay).toBe("2026-06-18");
    expect(slice.virtualCurrentMinuteOfDay).toBe(13 * 60 + 29);
    expect(slice.virtualNow).toBe("2026-06-18T13:30:00");
    expect(slice.segments[0]?.endedAt).toBe("2026-06-18T13:30:00");
  });

  it("Given a day replay duration When resolving timer cadence Then updates target one virtual minute per tick", () => {
    const anchor = buildDemoDashboardReplayAnchor({
      kind: "day",
      currentLogicalDay: "2026-06-18",
      startOfDayMinutes: 0,
      startOfWeek: "monday",
    });

    expect(resolveDemoDashboardReplayProgressIntervalMs({ anchor, durationSeconds: 45 })).toBe(31);
    expect(resolveDemoDashboardReplayProgressIntervalMs({ anchor, durationSeconds: 15 })).toBe(10);
  });
});
