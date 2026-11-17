import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shiftIsoDate, todayIsoDate, restoreCompactTimeline, compactTimelineMetadataKeys, classifyActivity } from "@drifty/domain";
import type { ActivitySegment, CompactTimelinePayload, CompactTimelineMetadata } from "@drifty/domain";

import { buildAccountStatsPayload, buildAccountStatsPayloadFromTracker, TOP_APPS_MAX, TOP_APPS_MIN_SECONDS } from "./accountStatsPayload";
import { trackerClient } from "../../lib/api/trackerClient";

vi.mock("../../lib/api/trackerClient", () => ({
  trackerClient: { getCompactTimeline: vi.fn(), getTimeline: vi.fn() },
}));

// Safari on stackoverflow.com classifies as focus (mirrors focusCardPublisher.test).
function makeSegment(day: string, durationSeconds: number, appName = "Safari"): ActivitySegment {
  const startedAt = new Date(`${day}T09:00:00.000Z`);
  const endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);
  return {
    id: `${day}-${appName}-${durationSeconds}`,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds,
    appName,
    siteDomain: appName === "Safari" ? "stackoverflow.com" : null,
    siteTitle: appName === "Safari" ? "Developer docs" : null,
    platform: "macos",
    source: "nsworkspace",
  };
}

const baseInput = { startOfDayMinutes: 0, includeAiClassifications: false };

describe("buildAccountStatsPayload", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("scopes today vs 7d vs 30d windows correctly", () => {
    const today = todayIsoDate();
    const monthStart = shiftIsoDate(today, -29);
    const midWeek = shiftIsoDate(today, -3);
    const outsideWeek = shiftIsoDate(today, -20);

    const payload = buildAccountStatsPayload(
      [makeSegment(today, 3600), makeSegment(midWeek, 1800), makeSegment(outsideWeek, 900)],
      { ...baseInput, windowEndDay: today },
    );

    // Today slice: only today's segment.
    expect(payload.focusSecondsToday).toBe(3600);
    expect(payload.driftSecondsToday).toBe(0);
    expect(payload.neutralSecondsToday).toBe(0);
    expect(payload.categoryBreakdownToday.reduce((sum, entry) => sum + entry.seconds, 0)).toBe(3600);

    // 7-day slice: today + mid-week, the 20-days-ago segment is excluded.
    expect(payload.focusSeconds7d).toBe(5400);
    expect(payload.driftSeconds7d).toBe(0);
    expect(payload.neutralSeconds7d).toBe(0);
    expect(payload.focusShare7d).toBe(1);
    expect(payload.categoryBreakdown7d.reduce((sum, entry) => sum + entry.seconds, 0)).toBe(5400);

    // 30-day series carries the full month.
    expect(payload.dailySeries30d).toHaveLength(30);
    const byDay = Object.fromEntries(payload.dailySeries30d.map((point) => [point.day, point.focus]));
    expect(payload.dailySeries30d[0]?.day).toBe(monthStart);
    expect(byDay[today]).toBe(3600);
    expect(byDay[midWeek]).toBe(1800);
    expect(byDay[outsideWeek]).toBe(900);
    expect(byDay[monthStart]).toBe(0);
    for (const point of payload.dailySeries30d) {
      expect(Object.keys(point).sort()).toEqual(["day", "drift", "focus", "neutral"]);
    }

    expect(payload.windowEndDate).toBe(today);
    expect(payload.timezone.length).toBeGreaterThan(0);
  });

  it("returns a zeroed but well-formed payload for an empty window", () => {
    const today = todayIsoDate();
    const payload = buildAccountStatsPayload([], { ...baseInput, windowEndDay: today });

    expect(payload.focusSecondsToday).toBe(0);
    expect(payload.driftSecondsToday).toBe(0);
    expect(payload.neutralSecondsToday).toBe(0);
    expect(payload.categoryBreakdownToday).toEqual([]);
    expect(payload.focusSeconds7d).toBe(0);
    expect(payload.focusShare7d).toBe(0);
    expect(payload.categoryBreakdown7d).toEqual([]);
    expect(payload.topApps7d).toEqual([]);
    expect(payload.hourlyPattern7d).toHaveLength(24);
    expect(payload.hourlyPattern7d.every((point) => point.focusSeconds === 0)).toBe(true);
    expect(payload.dailySeries30d).toHaveLength(30);
    expect(payload.dailySeries30d.every((point) => point.focus === 0)).toBe(true);
  });

  it("averages the hourly pattern per hour-of-day across the 7-day window", () => {
    const today = todayIsoDate();
    const midWeek = shiftIsoDate(today, -3);
    const outsideWeek = shiftIsoDate(today, -20);

    const payload = buildAccountStatsPayload(
      // Both in-week segments start 09:00Z = 18:00 KST (tests run with TZ=Asia/Seoul):
      // today's fills 18:00–19:00 (3600s), mid-week's 18:00–18:30 (1800s).
      [makeSegment(today, 3600), makeSegment(midWeek, 1800), makeSegment(outsideWeek, 900)],
      { ...baseInput, windowEndDay: today },
    );

    expect(payload.hourlyPattern7d).toHaveLength(24);
    expect(payload.hourlyPattern7d.map((point) => point.hour)).toEqual(Array.from({ length: 24 }, (_, hour) => hour));
    // (3600 + 1800) / 7 days; the out-of-week hour contributes nothing.
    expect(payload.hourlyPattern7d[18].focusSeconds).toBe(Math.round(5400 / 7));
    expect(payload.hourlyPattern7d.filter((point) => point.hour !== 18).every((point) => point.focusSeconds === 0)).toBe(true);
  });

  it("caps top apps at 5 and drops under-15-minute apps", () => {
    const today = todayIsoDate();
    const midWeek = shiftIsoDate(today, -2);
    const payload = buildAccountStatsPayload(
      [
        makeSegment(today, 7200, "Xcode"),
        makeSegment(today, 5400, "Safari"),
        makeSegment(midWeek, 4500, "Figma"),
        makeSegment(midWeek, 3600, "Slack"),
        makeSegment(today, 1800, "Notes"),
        makeSegment(midWeek, 1200, "Terminal"),
        makeSegment(today, TOP_APPS_MIN_SECONDS - 1, "Preview"), // under the 15-minute floor
      ],
      { ...baseInput, windowEndDay: today },
    );

    expect(payload.topApps7d).toHaveLength(TOP_APPS_MAX); // 6 qualify, capped at 5 — Terminal is cut
    expect(payload.topApps7d.map((entry) => entry.appName)).toEqual(["Xcode", "Safari", "Figma", "Slack", "Notes"]);
    expect(payload.topApps7d.every((entry) => entry.seconds >= TOP_APPS_MIN_SECONDS)).toBe(true);
    for (const entry of payload.topApps7d) {
      expect(Object.keys(entry).sort()).toEqual(["appName", "seconds"]);
    }
  });
});

describe("buildAccountStatsPayloadFromTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(trackerClient.getCompactTimeline).mockReset();
  });

  it("excludes browser-history-import segments from every aggregate", async () => {
    const today = todayIsoDate();
    const imported: ActivitySegment = {
      ...makeSegment(today, 7200, "Arc"),
      source: "browser-history-import",
    };
    vi.mocked(trackerClient.getCompactTimeline).mockResolvedValue([makeSegment(today, 3600), imported]);

    const payload = await buildAccountStatsPayloadFromTracker({ ...baseInput, windowEndDay: today });

    expect(payload.focusSecondsToday).toBe(3600);
    expect(payload.focusSeconds7d).toBe(3600);
    expect(payload.topApps7d.map((entry) => entry.appName)).toEqual(["Safari"]);
    expect(payload.dailySeries30d.find((point) => point.day === today)?.focus).toBe(3600);
  });

  it("excludes segments synced in from another Mac from every aggregate", async () => {
    const today = todayIsoDate();
    const remote: ActivitySegment = {
      ...makeSegment(today, 7200, "Arc"),
      deviceId: "11111111-2222-3333-4444-555555555555",
    };
    vi.mocked(trackerClient.getCompactTimeline).mockResolvedValue([makeSegment(today, 3600), remote]);

    const payload = await buildAccountStatsPayloadFromTracker({ ...baseInput, windowEndDay: today });

    // Otherwise every synced device would publish an inflated total that
    // double-counts the other device's activity.
    expect(payload.focusSecondsToday).toBe(3600);
    expect(payload.focusSeconds7d).toBe(3600);
    expect(payload.topApps7d.map((entry) => entry.appName)).toEqual(["Safari"]);
    expect(payload.dailySeries30d.find((point) => point.day === today)?.focus).toBe(3600);
  });

  it("excludes redacted app segments from top apps and focus aggregates", async () => {
    const today = todayIsoDate();
    const excluded: ActivitySegment = {
      ...makeSegment(today, 7200, "[Redacted]"),
      exclusionSource: "default",
    };
    vi.mocked(trackerClient.getCompactTimeline).mockResolvedValue([makeSegment(today, 3600), excluded]);

    const payload = await buildAccountStatsPayloadFromTracker({ ...baseInput, windowEndDay: today });

    expect(payload.focusSecondsToday).toBe(3600);
    expect(payload.focusSeconds7d).toBe(3600);
    expect(payload.topApps7d.map((entry) => entry.appName)).toEqual(["Safari"]);
    expect(payload.topApps7d.some((entry) => entry.appName === "[Redacted]")).toBe(false);
  });

  it("keeps failed Windows foreground captures out of published totals and top apps", async () => {
    const today = todayIsoDate();
    // Windows 1.11.22 and earlier stored a failed foreground read as an
    // "Unavailable" app with no identity; the dashboard already hides it.
    const failedCapture: ActivitySegment = {
      ...makeSegment(today, 7200, "Unavailable"),
      platform: "windows",
      source: "unknown",
      bundleId: null,
    };
    vi.mocked(trackerClient.getCompactTimeline).mockResolvedValue([makeSegment(today, 3600), failedCapture]);

    const payload = await buildAccountStatsPayloadFromTracker({ ...baseInput, windowEndDay: today });

    expect(payload.topApps7d.map((entry) => entry.appName)).toEqual(["Safari"]);
    expect(payload.neutralSecondsToday).toBe(0);
    expect(payload.neutralSeconds7d).toBe(0);
    expect(payload.categoryBreakdownToday.reduce((sum, entry) => sum + entry.seconds, 0)).toBe(3600);
  });
});


describe("compact account statistics equivalence", () => {
  const day = "2026-11-10";
  const shared: CompactTimelineMetadata = {
    youtubeCategory: "People & Blogs", youtubeChannelId: "qa-channel", youtubeChannelName: "QA",
    youtubeTitle: "Plain video", youtubeDescription: "music " + "가".repeat(5000), youtubeKeywords: [],
    youtubeDurationSeconds: 600, youtubeViewCount: 1, youtubeIsLive: false,
    youtubeIsUnlisted: false, youtubePublishDate: null, youtubeUploadDate: null,
  };
  function fixture(): ActivitySegment[] {
    const video = { ...makeSegment(day, 3600), ...shared, id: "video", siteDomain: "youtube.com",
      siteUrl: "https://www.youtube.com/watch?v=synthetic", youtubeVideoId: "synthetic" };
    return [
      video,
      { ...video, id: "keyword-only", youtubeDescription: null, youtubeKeywords: ["lyrics"] },
      { ...video, id: "manual", classification: { category: "workspace", productivity: "focus", source: "manual", confidence: 1 } },
      { ...video, id: "ai", classification: { category: "learning", productivity: "focus", source: "llm", confidence: 0.9, aiResult: true } },
      { ...makeSegment(shiftIsoDate(day, -3), 1800), id: "week" },
      { ...makeSegment(shiftIsoDate(day, -20), 900), id: "month" },
      { ...video, id: "remote", deviceId: "qa-remote" },
      { ...video, id: "excluded", exclusionSource: "user" },
      { ...video, id: "import", source: "browser-history-import" },
      { ...video, id: "failed", appName: "Unavailable", bundleId: null, platform: "windows", source: "unknown" },
    ];
  }
  function pack(records: ActivitySegment[]): CompactTimelinePayload {
    const metadata: CompactTimelineMetadata[] = [];
    const indexes = new Map<string, number>();
    return { items: records.map(row => {
      const meta = Object.fromEntries(compactTimelineMetadataKeys.map(key => [key, row[key] ?? null])) as CompactTimelineMetadata;
      const key = JSON.stringify(meta);
      if (!indexes.has(key)) { indexes.set(key, metadata.length); metadata.push(meta); }
      const item = Object.fromEntries(Object.entries(row).filter(([key]) => !compactTimelineMetadataKeys.includes(key as typeof compactTimelineMetadataKeys[number])));
      return { ...item, youtubeMetadataIndex: indexes.get(key)! } as CompactTimelinePayload["items"][number];
    }), youtubeMetadata: metadata };
  }
  beforeEach(() => vi.clearAllMocks());

  it("keeps description and keyword evidence that would change the bucket if omitted", () => {
    const [video, keyword] = fixture();
    expect(classifyActivity(video).category).toBe("music");
    expect(classifyActivity({ ...video, youtubeDescription: null }).category).toBe("entertainment");
    expect(classifyActivity(keyword).category).toBe("music");
    expect(classifyActivity({ ...keyword, youtubeKeywords: null }).category).toBe("entertainment");
  });

  it.each([
    { includeAiClassifications: false, startOfDayMinutes: 0 },
    { includeAiClassifications: true, startOfDayMinutes: 240 },
    { includeAiClassifications: true, includeBuiltInHeuristics: false, startOfDayMinutes: 0 },
    { includeAiClassifications: false, builtInHeuristicsUnavailableSince: "2026-11-01T00:00:00Z", startOfDayMinutes: 240 },
    { includeAiClassifications: true, categoryProductivity: { music: "focus" as const }, deletedCategories: { learning: "2026-11-01T00:00:00Z" }, startOfDayMinutes: 0 },
  ])("preserves every payload field for %j", async (options) => {
    const records = fixture();
    const packet = pack(records);
    for (const meta of packet.youtubeMetadata) {
      if (meta.youtubeKeywords) Object.freeze(meta.youtubeKeywords);
      Object.freeze(meta);
    }
    const restored = restoreCompactTimeline(packet);
    vi.mocked(trackerClient.getCompactTimeline).mockResolvedValueOnce(records).mockResolvedValueOnce(restored);
    const input = { ...options, windowEndDay: day };
    const expected = await buildAccountStatsPayloadFromTracker(input);
    const actual = await buildAccountStatsPayloadFromTracker(input);
    expect(actual).toEqual(expected);
    expect(trackerClient.getTimeline).not.toHaveBeenCalled();
  });

  it("propagates a limit failure without retrying the unbounded route", async () => {
    vi.mocked(trackerClient.getCompactTimeline).mockRejectedValueOnce(new Error("tracker_timeline_too_large"));
    await expect(buildAccountStatsPayloadFromTracker({ ...baseInput, windowEndDay: day })).rejects.toThrow("tracker_timeline_too_large");
    expect(trackerClient.getTimeline).not.toHaveBeenCalled();
  });
});
