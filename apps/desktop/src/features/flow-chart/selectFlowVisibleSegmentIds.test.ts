import { describe, expect, it } from "vitest";
import { buildFlowBlocks, selectFlowVisibleSegmentIds } from "@drifty/domain";
import type { ActivitySegment } from "@drifty/domain";

const DAY = "2026-04-06";

// Local (timezone-naive) ISO strings, matching how buildFlowBlocks reads segment times.
function segment(input: { id: string; start: string; end: string; appName: string; siteDomain?: string | null }): ActivitySegment {
  return {
    id: input.id,
    startedAt: input.start,
    endedAt: input.end,
    durationSeconds: Math.round((new Date(input.end).getTime() - new Date(input.start).getTime()) / 1000),
    appName: input.appName,
    bundleId: null,
    windowTitle: null,
    browserName: null,
    siteDomain: input.siteDomain ?? null,
    siteTitle: null,
    siteUrl: null,
    platform: "macos",
    source: "nsworkspace",
    classification: null,
  };
}

// minuteOfDay for 09:00 (the bucket all fixtures land in at both intervals under test).
const NINE_AM_MINUTE_OF_DAY = 9 * 60;

function blockColorKeyAt(blocks: ReturnType<typeof buildFlowBlocks>, minuteOfDay: number): string | undefined {
  return blocks.find((block) => block.minuteOfDay === minuteOfDay)?.colorKey;
}

describe("selectFlowVisibleSegmentIds", () => {
  it("keeps only the winning (longest-overlap) candidate when candidates share a bucket", () => {
    const longSegment = segment({ id: "long", start: `${DAY}T09:00:00`, end: `${DAY}T09:02:30`, appName: "Work" });
    const shortSegment = segment({ id: "short", start: `${DAY}T09:01:00`, end: `${DAY}T09:01:20`, appName: "Distract" });
    const segments = [longSegment, shortSegment];

    const visible = selectFlowVisibleSegmentIds(segments, DAY, 3);

    expect(visible).toEqual(new Set(["long"]));
    // Consistent with the block buildFlowBlocks draws for this bucket.
    expect(blockColorKeyAt(buildFlowBlocks(segments, DAY, 3), NINE_AM_MINUTE_OF_DAY)).toBe("Work");
  });

  it("accumulates overlap across segments sharing a colorKey so all its members are visible", () => {
    const shared1 = segment({ id: "shared-1", start: `${DAY}T09:00:10`, end: `${DAY}T09:00:50`, appName: "Shared" });
    const shared2 = segment({ id: "shared-2", start: `${DAY}T09:02:00`, end: `${DAY}T09:02:50`, appName: "Shared" });
    const other = segment({ id: "other", start: `${DAY}T09:01:00`, end: `${DAY}T09:02:00`, appName: "Other" });
    const segments = [shared1, shared2, other];

    // "Shared" totals 90s (40 + 50) across two members and beats "Other" (60s).
    const visible = selectFlowVisibleSegmentIds(segments, DAY, 3);

    expect(visible).toEqual(new Set(["shared-1", "shared-2"]));
    expect(blockColorKeyAt(buildFlowBlocks(segments, DAY, 3), NINE_AM_MINUTE_OF_DAY)).toBe("Shared");
  });

  it("groups by colorKey using siteDomain over appName, matching buildFlowBlocks", () => {
    // Same app, different domains → two candidates; the longer domain wins.
    const news = segment({ id: "news", start: `${DAY}T09:00:00`, end: `${DAY}T09:00:40`, appName: "Safari", siteDomain: "news.example" });
    const docs = segment({ id: "docs", start: `${DAY}T09:01:00`, end: `${DAY}T09:02:40`, appName: "Safari", siteDomain: "docs.example" });
    const segments = [news, docs];

    const visible = selectFlowVisibleSegmentIds(segments, DAY, 3);

    expect(visible).toEqual(new Set(["docs"]));
    expect(blockColorKeyAt(buildFlowBlocks(segments, DAY, 3), NINE_AM_MINUTE_OF_DAY)).toBe("docs.example");
  });

  it("excludes segments outside the requested logical day", () => {
    const today = segment({ id: "today", start: `${DAY}T09:00:00`, end: `${DAY}T09:02:00`, appName: "Work" });
    const tomorrow = segment({ id: "tomorrow", start: "2026-04-07T09:00:00", end: "2026-04-07T09:02:00", appName: "Work" });

    expect(selectFlowVisibleSegmentIds([today, tomorrow], DAY, 3)).toEqual(new Set(["today"]));
  });

  it("honors the start-of-day boundary when assigning segments to a logical day", () => {
    // With a 4am start-of-day, 02:00 belongs to the previous logical day, not DAY.
    const earlyMorning = segment({ id: "early", start: `${DAY}T02:00:00`, end: `${DAY}T02:02:00`, appName: "Work" });

    expect(selectFlowVisibleSegmentIds([earlyMorning], DAY, 3, undefined, 4 * 60)).toEqual(new Set());
    expect(selectFlowVisibleSegmentIds([earlyMorning], DAY, 3)).toEqual(new Set(["early"]));
  });

  it("respects the interval: separate 3-minute buckets both stay visible even though 5 minutes merges them", () => {
    const alpha = segment({ id: "alpha", start: `${DAY}T09:01:00`, end: `${DAY}T09:01:40`, appName: "Alpha" });
    const beta = segment({ id: "beta", start: `${DAY}T09:04:00`, end: `${DAY}T09:05:00`, appName: "Beta" });
    const segments = [alpha, beta];

    // 3-minute buckets: 09:00 (alpha) and 09:03 (beta) are distinct — both win their bucket.
    expect(selectFlowVisibleSegmentIds(segments, DAY, 3)).toEqual(new Set(["alpha", "beta"]));
    // 5-minute buckets: both fall in 09:00 → beta (60s) beats alpha (40s).
    expect(selectFlowVisibleSegmentIds(segments, DAY, 5)).toEqual(new Set(["beta"]));
  });
});
