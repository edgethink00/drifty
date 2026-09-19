import { describe, expect, it } from "vitest";
import {
  buildSparklineGeometry,
  parseLeaderboardGraphStyle,
  sparklineWeekdayLetter,
} from "./leaderboardGraphStyle";

describe("parseLeaderboardGraphStyle", () => {
  it("accepts known styles", () => {
    expect(parseLeaderboardGraphStyle("default")).toBe("default");
    expect(parseLeaderboardGraphStyle("layered")).toBe("layered");
  });

  it("falls back to off for missing or unknown values", () => {
    expect(parseLeaderboardGraphStyle(null)).toBe("off");
    expect(parseLeaderboardGraphStyle(undefined)).toBe("off");
    expect(parseLeaderboardGraphStyle("heatmap")).toBe("off");
    expect(parseLeaderboardGraphStyle("")).toBe("off");
  });
});

describe("buildSparklineGeometry", () => {
  it("returns no points for a single value", () => {
    expect(buildSparklineGeometry([12])).toEqual([]);
  });

  it("clamps negatives and maps the peak to the top pad", () => {
    const points = buildSparklineGeometry([-10, 0, 20]);
    expect(points).toHaveLength(3);
    expect(points[0]?.y).toBeGreaterThan(points[2]?.y ?? 0);
    expect(points[1]?.y).toBe(points[0]?.y);
  });
});

describe("sparklineWeekdayLetter", () => {
  it("uses Korean weekday letters", () => {
    expect(sparklineWeekdayLetter("2026-09-14", "ko")).toBe("월");
  });

  it("keeps Saturday and Sunday distinct in English", () => {
    expect(sparklineWeekdayLetter("2026-09-19", "en")).toBe("Sa");
    expect(sparklineWeekdayLetter("2026-09-20", "en")).toBe("Su");
  });

  it("returns empty for invalid dates", () => {
    expect(sparklineWeekdayLetter("not-a-day", "en")).toBe("");
  });
});
