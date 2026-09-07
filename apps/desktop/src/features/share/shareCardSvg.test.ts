import { describe, expect, it } from "vitest";
import type { ShareCardData, ShareWeekCardData } from "./shareCard";
import {
  SHARE_CARD_EXPORT_SIZES,
  SHARE_CARD_UNIFIED_SIZE,
  UNIFIED_STORY_OPTIONS,
  renderShareCardSvg,
  renderShareWeekCardSvg,
} from "./shareCardSvg";
import { renderLockedShareRankSvg } from "./shareCardUnifiedSvg";

const dailyModel = {
  version: 1 as const, source: "leaderboard" as const, period: "daily" as const,
  sampleSize: 100, participantCount: 100,
  logMeanMinutes: Math.log(100), logStandardDeviationMinutes: 0.5,
  generatedAt: new Date().toISOString(),
};
const MODELS = { daily: dailyModel, weekly: { ...dailyModel, period: "weekly" as const } };

const DAY: ShareCardData = {
  day: "2026-07-17",
  weekdayLabel: "Friday",
  dateLabel: "Jul 17",
  totalSeconds: 7 * 3600,
  focusSeconds: 5 * 3600 + 42 * 60,
  isCurrentPeriod: true,
  focusPercent: 72,
  productivitySlices: [
    { key: "focus", seconds: 5 * 3600 + 42 * 60, ratio: 0.72 },
    { key: "neutral", seconds: 4_320, ratio: 0.17 },
    { key: "drift", seconds: 2_772, ratio: 0.11 },
  ],
  deltaSeconds: 48 * 60,
  slices: [
    { key: "workspace", label: "Workspace", seconds: 4 * 3600, ratio: 0.57 },
    { key: "communication", label: "Communication", seconds: 5400, ratio: 0.21 },
  ],
  hours: Array.from({ length: 24 }, (_, hour) => ({
    hour,
    focusSeconds: hour >= 9 && hour <= 18 ? 1800 : 0,
    driftSeconds: hour === 15 ? 1200 : 0,
    neutralSeconds: hour === 12 ? 900 : 0,
  })),
  longestFocusSeconds: 2 * 3600 + 41 * 60,
  peakFocusLabel: "14–16h",
};

const WEEK: ShareWeekCardData = {
  startDay: "2026-07-13",
  endDay: "2026-07-19",
  comparisonDay: "2026-07-19",
  weekLabel: "Week 29",
  rangeLabel: "Jul 13–19",
  totalSeconds: 28 * 3600,
  focusSeconds: 22 * 3600 + 40 * 60,
  isCurrentPeriod: true,
  avgDailyFocusSeconds: 3 * 3600 + 14 * 60,
  focusPercent: 74,
  productivitySlices: [
    { key: "focus", seconds: 22 * 3600 + 40 * 60, ratio: 0.74 },
    { key: "neutral", seconds: 6_480, ratio: 0.06 },
    { key: "drift", seconds: 21_120, ratio: 0.2 },
  ],
  deltaSeconds: 3 * 3600 + 5 * 60,
  days: [
    { day: "2026-07-13", letter: "M", focusSeconds: 4 * 3600, isBest: false },
    { day: "2026-07-14", letter: "T", focusSeconds: 6 * 3600, isBest: true },
  ],
  bestDayLabel: "Tuesday",
  longestFocusSeconds: 2 * 3600 + 41 * 60,
  slices: [{ key: "workspace", label: "Workspace", seconds: 14 * 3600, ratio: 0.62 }],
};

describe("renderShareCardSvg", () => {
  it("uses a locked rank preview instead of inventing a percentile", () => {
    const svg = renderLockedShareRankSvg({ theme: "light", period: "daily" });

    expect(svg).toContain("Join the leaderboard");
    expect(svg).toContain("reveal your live focus rank for today");
    expect(svg).not.toContain("100%");
  });

  it("renders the unified landscape card at 1200×900", () => {
    const svg = renderShareCardSvg({ communityModels: MODELS, data: DAY, format: "landscape", theme: "dark", story: "R1c" });
    expect(svg).toContain(`width="${SHARE_CARD_EXPORT_SIZES.landscape.width}"`);
    expect(svg).toContain(`height="${SHARE_CARD_EXPORT_SIZES.landscape.height}"`);
    expect(svg).toContain(`viewBox="0 0 ${SHARE_CARD_UNIFIED_SIZE.width} ${SHARE_CARD_UNIFIED_SIZE.height}"`);
    expect(svg).toContain("Estimated focus percentile");
    expect(svg).toContain("drifty.so");
  });

  it("renders Korean copy inside the exported daily cards", () => {
    const koreanDay: ShareCardData = {
      ...DAY,
      language: "ko",
      weekdayLabel: "금요일",
      dateLabel: "7월 17일",
      slices: DAY.slices.map((slice) => ({ ...slice, label: slice.key === "workspace" ? "작업" : "커뮤니케이션" })),
    };
    const percentile = renderShareCardSvg({ communityModels: MODELS, data: koreanDay, format: "landscape", theme: "light", story: "R1c" });
    const productivity = renderShareCardSvg({ communityModels: MODELS, data: koreanDay, format: "landscape", theme: "light", story: "X5" });

    expect(percentile).toContain("예상 집중 백분위");
    expect(percentile).toContain("리더보드 참여자 100명 기준 추정");
    expect(productivity).toContain("생산성");
    expect(productivity).toContain("집중");
    expect(productivity).toContain("시간");
  });

  it("keeps the unified lineup as the primary story set", () => {
    expect(UNIFIED_STORY_OPTIONS.map((entry) => entry.value)).toEqual([
      "R1c",
      "WR1",
      "R2",
      "F1",
      "C1",
      "W5",
      "W4",
      "S1",
      "X6",
      "X4",
      "X5",
      "R4",
    ]);
  });

  it("renders distinct unified stories with per-card accents", () => {
    const curve = renderShareCardSvg({ communityModels: MODELS, data: DAY, format: "landscape", theme: "light", story: "R1c", lookIndex: 0 });
    const focus = renderShareCardSvg({ communityModels: MODELS, data: DAY, format: "landscape", theme: "light", story: "F1", lookIndex: 4 });
    const streak = renderShareCardSvg({ communityModels: MODELS, data: DAY, format: "landscape", theme: "light", story: "S1", lookIndex: 8 });

    expect(curve).toContain("Estimated focus percentile");
    expect(curve).toContain("%");
    expect(focus).toContain("Focus time");
    expect(focus).toMatch(/\d+h|\d+m/);
    expect(streak).toContain("Focus streak");
    expect(curve).not.toEqual(focus);
    expect(focus).not.toEqual(streak);
  });

  it("cycles card looks when lookIndex changes", () => {
    const a = renderShareCardSvg({ communityModels: MODELS, data: DAY, format: "landscape", theme: "light", story: "R1c", lookIndex: 0 });
    const b = renderShareCardSvg({ communityModels: MODELS, data: DAY, format: "landscape", theme: "light", story: "R1c", lookIndex: 1 });
    expect(a).not.toEqual(b);
  });

  it("uses the official Drifty lockup and fixed site link", () => {
    const svg = renderShareCardSvg({ communityModels: MODELS, data: DAY, format: "landscape", theme: "dark", story: "R1c" });
    expect(svg).toContain('viewBox="48 236 1680 471"');
    expect(svg).toContain('href="data:image/png;base64,');
    expect(svg).toContain("drifty.so");
  });

  it("supports both app themes", () => {
    const dark = renderShareCardSvg({ communityModels: MODELS, data: DAY, format: "landscape", theme: "dark", story: "R1c" });
    const light = renderShareCardSvg({ communityModels: MODELS, data: DAY, format: "landscape", theme: "light", story: "R1c" });
    expect(dark).toContain("#");
    expect(light).toContain("#");
    expect(dark).not.toEqual(light);
  });

  it("handles a zero-focus day without invalid SVG values", () => {
    const svg = renderShareCardSvg({ communityModels: MODELS,
      data: { ...DAY, focusSeconds: 0, focusPercent: 0 },
      format: "landscape",
      theme: "light",
      story: "F1",
    });
    expect(svg).toMatch(/0m|0h/);
    expect(svg).not.toContain("NaN");
    expect(svg).not.toContain("Infinity");
  });

  it("normalizes malformed aggregate numbers before rendering a share image", () => {
    const svg = renderShareCardSvg({ communityModels: MODELS,
      data: {
        ...DAY,
        focusSeconds: Number.NaN,
        totalSeconds: Number.POSITIVE_INFINITY,
        focusPercent: Number.NaN,
        productivitySlices: [{ key: "focus", seconds: Number.POSITIVE_INFINITY, ratio: Number.NaN }],
        slices: [{ key: "workspace", label: "Workspace", seconds: Number.NaN, ratio: Number.POSITIVE_INFINITY }],
        hours: [{ hour: 9, focusSeconds: Number.POSITIVE_INFINITY, driftSeconds: Number.NaN, neutralSeconds: Number.NaN }],
      },
      format: "landscape",
      theme: "light",
      story: "X5",
    });

    expect(svg).not.toContain("NaN");
    expect(svg).not.toContain("Infinity");
  });

  it("uses the real community model without a separate elapsed-day adjustment", () => {
    const svg = renderShareCardSvg({ communityModels: MODELS,
      data: { ...DAY, focusSeconds: 100 * 60 },
      format: "landscape",
      theme: "light",
      story: "R1c",
    });

    expect(svg).toContain(">Top 50%<");
    expect(svg).toContain("From 100 leaderboard participants");
  });

  it("prefers a matching live daily leaderboard percentile over the estimate", () => {
    const svg = renderShareCardSvg({ communityModels: MODELS,
      data: { ...DAY, focusSeconds: 100 * 60 },
      format: "landscape",
      theme: "light",
      story: "R1c",
      liveRanks: {
        daily: {
          rank: 9,
          participantCount: 100,
          topPercent: 9,
          windowStartDay: DAY.day,
          windowEndDay: DAY.day,
        },
        weekly: null,
      },
    });

    expect(svg).toContain("Today's focus percentile");
    expect(svg).toContain(">Top 9%<");
    expect(svg).toContain("live leaderboard");
    expect(svg).not.toContain("Estimated focus percentile");
  });

  it("uses historical copy for a completed selected day", () => {
    const percentile = renderShareCardSvg({ communityModels: MODELS,
      data: { ...DAY, isCurrentPeriod: false },
      format: "landscape",
      theme: "light",
      story: "R1c",
    });
    const focus = renderShareCardSvg({ communityModels: MODELS,
      data: { ...DAY, isCurrentPeriod: false },
      format: "landscape",
      theme: "light",
      story: "F1",
    });

    expect(percentile).toContain("focused work on Jul 17");
    expect(percentile).not.toContain("Estimated focus percentile");
    expect(percentile).not.toContain("so far today");
    expect(focus).toContain("focused work on Jul 17");
  });

  it("rejects a malformed live percentile instead of labeling an estimate live", () => {
    const svg = renderShareCardSvg({ communityModels: MODELS,
      data: { ...DAY, focusSeconds: 100 * 60 },
      format: "landscape",
      theme: "light",
      story: "R1c",
      liveRanks: {
        daily: {
          rank: 9,
          participantCount: 100,
          topPercent: Number.NaN,
          windowStartDay: DAY.day,
          windowEndDay: DAY.day,
        },
        weekly: null,
      },
    });

    expect(svg).toContain("Estimated focus percentile");
    expect(svg).toContain(">Top 50%<");
    expect(svg).not.toContain("live leaderboard");
  });

  it("renders category durations from exact seconds instead of rounded shares", () => {
    const svg = renderShareCardSvg({ communityModels: MODELS, data: DAY, format: "landscape", theme: "light", story: "X4" });

    expect(svg).toContain(">4h<");
    expect(svg).toContain(">1h 30m<");
    expect(svg).not.toContain(">5h 07m<");
  });

  it("renders productivity shares and durations against classified time", () => {
    const svg = renderShareCardSvg({ communityModels: MODELS,
      data: {
        ...DAY,
        totalSeconds: 10 * 3600,
        focusSeconds: 5 * 3600,
        focusPercent: 63,
        productivitySlices: [
          { key: "focus", seconds: 5 * 3600, ratio: 0.625 },
          { key: "neutral", seconds: 2 * 3600, ratio: 0.25 },
          { key: "drift", seconds: 1 * 3600, ratio: 0.125 },
        ],
      },
      format: "landscape",
      theme: "light",
      story: "X5",
    });

    expect(svg).toContain(">63%<");
    expect(svg).toContain(">5.0h<");
    expect(svg).toContain(">2.0h<");
    expect(svg).toContain(">1.0h<");
  });
});

describe("renderShareWeekCardSvg", () => {
  it("renders the weekly unified percentile curve card", () => {
    const svg = renderShareWeekCardSvg({ communityModels: MODELS, data: WEEK, format: "landscape", theme: "dark", story: "WR1" });
    expect(svg).toContain(`viewBox="0 0 ${SHARE_CARD_UNIFIED_SIZE.width} ${SHARE_CARD_UNIFIED_SIZE.height}"`);
    expect(svg).toContain("Estimated weekly percentile");
    expect(svg).toContain("drifty.so");
  });

  it("renders Korean copy inside the exported weekly cards", () => {
    const koreanWeek: ShareWeekCardData = {
      ...WEEK,
      language: "ko",
      weekLabel: "29주차",
      rangeLabel: "7월 13일–19일",
    };
    const percentile = renderShareWeekCardSvg({ communityModels: MODELS, data: koreanWeek, format: "landscape", theme: "light", story: "WR1" });
    const average = renderShareWeekCardSvg({ communityModels: MODELS, data: koreanWeek, format: "landscape", theme: "light", story: "W5" });

    expect(percentile).toContain("예상 주간 백분위");
    expect(percentile).toContain("리더보드 참여자 100명 기준 추정");
    expect(average).toContain("이번 주");
    expect(average).toContain("기록일 평균");
  });

  it("renders weekly productivity and streak stories", () => {
    const productivity = renderShareWeekCardSvg({ communityModels: MODELS, data: WEEK, format: "landscape", theme: "light", story: "X5", lookIndex: 11 });
    const streak = renderShareWeekCardSvg({ communityModels: MODELS, data: WEEK, format: "landscape", theme: "light", story: "S1", lookIndex: 8 });
    expect(productivity).toContain("Productivity");
    expect(streak).toContain("Focus streak");
    expect(productivity).not.toEqual(streak);
  });

  it("uses historical copy and an explicit tracked-day average", () => {
    const percentile = renderShareWeekCardSvg({ communityModels: MODELS,
      data: { ...WEEK, isCurrentPeriod: false },
      format: "landscape",
      theme: "light",
      story: "WR1",
    });
    const average = renderShareWeekCardSvg({ communityModels: MODELS,
      data: { ...WEEK, isCurrentPeriod: false },
      format: "landscape",
      theme: "light",
      story: "W5",
    });

    expect(percentile).toContain("focused work in Week 29");
    expect(percentile).not.toContain("Estimated weekly percentile");
    expect(average).toContain("Week 29");
    expect(average).toContain("TRACKED-DAY AVG");
    expect(average).toContain("tracked day that week");
  });
});


describe("shareable focus-time fallback", () => {
  it.each(["R1c", "R2", "C1"] as const)("keeps %s useful without claiming an unavailable rank", (story) => {
    const svg = renderShareCardSvg({ data: DAY, format: "landscape", theme: "light", story });
    expect(svg).toContain("Focus time");
    expect(svg).not.toMatch(/(?:Top|TOP|상위) [\d.]+%/);
    expect(svg).not.toContain("Estimated focus percentile");
    expect(svg).not.toContain("NaN");
  });

  it("omits a percentile for a mismatched calendar week even with fresh statistics", () => {
    const svg = renderShareWeekCardSvg({
      data: { ...WEEK, comparisonDay: "2026-07-17" }, communityModels: MODELS,
      format: "landscape", theme: "dark", story: "WR1",
    });
    expect(svg).toContain("focused work this week");
    expect(svg).not.toContain("Estimated weekly percentile");
  });

  it("rejects a rank from another day at the export boundary", () => {
    const svg = renderShareCardSvg({ data: DAY, format: "landscape", theme: "light", story: "R1c",
      liveRanks: { daily: { rank: 1, participantCount: 100, topPercent: 1,
        windowStartDay: "2026-07-16", windowEndDay: "2026-07-16" }, weekly: null },
    });
    expect(svg).toContain("Focus time");
    expect(svg).not.toContain("live leaderboard");
  });
});
