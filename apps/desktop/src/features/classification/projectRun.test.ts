import { describe, expect, it } from "vitest";
import {
  compactActivityRuns,
  formatProjectRunLine,
  formatRunDuration,
  type ActivitySegment,
  type StoredActivityClassification,
} from "@drifty/domain";

function seg(
  fields: Pick<ActivitySegment, "id" | "startedAt" | "endedAt" | "durationSeconds" | "appName"> &
    Partial<ActivitySegment>,
): ActivitySegment {
  return { platform: "macos", source: "accessibility", ...fields };
}

function classification(
  category: StoredActivityClassification["category"],
  productivity: StoredActivityClassification["productivity"],
  source: StoredActivityClassification["source"] = "llm",
): StoredActivityClassification {
  return { category, productivity, source, confidence: 0.9 };
}

describe("compactActivityRuns", () => {
  it("merges consecutive same app+domain segments within the gap", () => {
    const runs = compactActivityRuns([
      seg({ id: "1", startedAt: "2026-04-06T09:00:00+00:00", endedAt: "2026-04-06T09:05:00+00:00", durationSeconds: 300, appName: "Code" }),
      seg({ id: "2", startedAt: "2026-04-06T09:05:30+00:00", endedAt: "2026-04-06T09:10:00+00:00", durationSeconds: 270, appName: "Code" }),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0].segmentIds).toEqual(["1", "2"]);
    expect(runs[0].durationSeconds).toBe(570);
    expect(runs[0].startedAt).toBe("2026-04-06T09:00:00+00:00");
    expect(runs[0].endedAt).toBe("2026-04-06T09:10:00+00:00");
    expect(runs[0].id).toBe("r0");
  });

  it("does not merge across different apps", () => {
    const runs = compactActivityRuns([
      seg({ id: "1", startedAt: "2026-04-06T09:00:00+00:00", endedAt: "2026-04-06T09:05:00+00:00", durationSeconds: 300, appName: "Code" }),
      seg({ id: "2", startedAt: "2026-04-06T09:05:10+00:00", endedAt: "2026-04-06T09:10:00+00:00", durationSeconds: 290, appName: "Slack" }),
    ]);
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.appName)).toEqual(["Code", "Slack"]);
  });

  it("does not merge across different site domains on the same app", () => {
    const runs = compactActivityRuns([
      seg({ id: "1", startedAt: "2026-04-06T09:00:00+00:00", endedAt: "2026-04-06T09:05:00+00:00", durationSeconds: 300, appName: "Chrome", siteDomain: "github.com" }),
      seg({ id: "2", startedAt: "2026-04-06T09:05:10+00:00", endedAt: "2026-04-06T09:10:00+00:00", durationSeconds: 290, appName: "Chrome", siteDomain: "youtube.com" }),
    ]);
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.domain)).toEqual(["github.com", "youtube.com"]);
  });

  it("does not merge when the gap exceeds the threshold", () => {
    const runs = compactActivityRuns(
      [
        seg({ id: "1", startedAt: "2026-04-06T09:00:00+00:00", endedAt: "2026-04-06T09:05:00+00:00", durationSeconds: 300, appName: "Code" }),
        seg({ id: "2", startedAt: "2026-04-06T09:10:00+00:00", endedAt: "2026-04-06T09:15:00+00:00", durationSeconds: 300, appName: "Code" }),
      ],
      { maxGapSeconds: 90 },
    );
    expect(runs).toHaveLength(2);
  });

  it("picks the dominant (longest) segment's classification and context", () => {
    const runs = compactActivityRuns([
      seg({ id: "1", startedAt: "2026-04-06T09:00:00+00:00", endedAt: "2026-04-06T09:01:00+00:00", durationSeconds: 60, appName: "Chrome", siteDomain: "youtube.com", siteTitle: "short clip", classification: classification("entertainment", "drift") }),
      seg({ id: "2", startedAt: "2026-04-06T09:01:00+00:00", endedAt: "2026-04-06T09:11:00+00:00", durationSeconds: 600, appName: "Chrome", siteDomain: "youtube.com", siteTitle: "long tutorial", youtubeChannelName: "DevChannel", classification: classification("learning", "focus") }),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0].category).toBe("learning");
    expect(runs[0].productivity).toBe("focus");
    expect(runs[0].context).toBe("long tutorial · DevChannel");
  });

  it("flags a run as shorts when any segment is a short", () => {
    const runs = compactActivityRuns([
      seg({ id: "1", startedAt: "2026-04-06T09:00:00+00:00", endedAt: "2026-04-06T09:03:00+00:00", durationSeconds: 180, appName: "Chrome", siteDomain: "youtube.com", youtubeIsShorts: true }),
    ]);
    expect(runs[0].isShorts).toBe(true);
  });

  it("drops title context when the privacy toggle is off", () => {
    const runs = compactActivityRuns(
      [seg({ id: "1", startedAt: "2026-04-06T09:00:00+00:00", endedAt: "2026-04-06T09:05:00+00:00", durationSeconds: 300, appName: "Chrome", siteDomain: "github.com", siteTitle: "secret repo" })],
      { includeTitleContext: false },
    );
    expect(runs[0].context).toBeNull();
  });

  it("coalesces a cluster of consecutive sub-minute runs into one minor line", () => {
    const runs = compactActivityRuns([
      seg({ id: "1", startedAt: "2026-04-06T09:00:00+00:00", endedAt: "2026-04-06T09:00:20+00:00", durationSeconds: 20, appName: "Finder" }),
      seg({ id: "2", startedAt: "2026-04-06T09:00:30+00:00", endedAt: "2026-04-06T09:00:50+00:00", durationSeconds: 20, appName: "Notes" }),
      seg({ id: "3", startedAt: "2026-04-06T09:01:00+00:00", endedAt: "2026-04-06T09:11:00+00:00", durationSeconds: 600, appName: "Code" }),
    ]);
    expect(runs).toHaveLength(2);
    expect(runs[0].minor).toBe(true);
    expect(runs[0].minorCount).toBe(2);
    expect(runs[0].appName).toBe("Multiple apps");
    expect(runs[0].segmentIds).toEqual(["1", "2"]);
    expect(runs[1].appName).toBe("Code");
  });

  it("keeps a lone sub-minute run rather than coalescing it", () => {
    const runs = compactActivityRuns([
      seg({ id: "1", startedAt: "2026-04-06T09:00:00+00:00", endedAt: "2026-04-06T09:10:00+00:00", durationSeconds: 600, appName: "Code" }),
      seg({ id: "2", startedAt: "2026-04-06T09:10:10+00:00", endedAt: "2026-04-06T09:10:30+00:00", durationSeconds: 20, appName: "Finder" }),
      seg({ id: "3", startedAt: "2026-04-06T09:11:00+00:00", endedAt: "2026-04-06T09:21:00+00:00", durationSeconds: 600, appName: "Slack" }),
    ]);
    expect(runs).toHaveLength(3);
    expect(runs[1].minor).toBe(false);
    expect(runs[1].appName).toBe("Finder");
  });

  it("sorts out-of-order input before merging", () => {
    const runs = compactActivityRuns([
      seg({ id: "2", startedAt: "2026-04-06T09:05:30+00:00", endedAt: "2026-04-06T09:10:00+00:00", durationSeconds: 270, appName: "Code" }),
      seg({ id: "1", startedAt: "2026-04-06T09:00:00+00:00", endedAt: "2026-04-06T09:05:00+00:00", durationSeconds: 300, appName: "Code" }),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0].segmentIds).toEqual(["1", "2"]);
  });
});

describe("formatRunDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatRunDuration(300)).toBe("5m");
    expect(formatRunDuration(3600)).toBe("1h");
    expect(formatRunDuration(3900)).toBe("1h 5m");
  });
});

describe("formatProjectRunLine", () => {
  it("renders a normal classified run", () => {
    const [run] = compactActivityRuns([
      seg({ id: "1", startedAt: "2026-04-06T13:02:00+00:00", endedAt: "2026-04-06T13:41:00+00:00", durationSeconds: 2340, appName: "Chrome", siteDomain: "youtube.com", siteTitle: "clip", classification: classification("entertainment", "drift") }),
    ]);
    expect(formatProjectRunLine(run)).toBe("r0 | 13:02–13:41 (39m) | Chrome · youtube.com | clip | current: entertainment/drift (llm)");
  });

  it("renders an unclassified run without a label", () => {
    const [run] = compactActivityRuns([
      seg({ id: "1", startedAt: "2026-04-06T13:02:00+00:00", endedAt: "2026-04-06T13:12:00+00:00", durationSeconds: 600, appName: "Terminal" }),
    ]);
    expect(formatProjectRunLine(run)).toBe("r0 | 13:02–13:12 (10m) | Terminal | current: unclassified");
  });

  it("marks shorts", () => {
    const [run] = compactActivityRuns([
      seg({ id: "1", startedAt: "2026-04-06T13:02:00+00:00", endedAt: "2026-04-06T13:17:00+00:00", durationSeconds: 900, appName: "Chrome", siteDomain: "youtube.com", youtubeIsShorts: true, classification: classification("social_media", "drift") }),
    ]);
    expect(formatProjectRunLine(run)).toContain("shorts");
  });

  it("renders a coalesced minor line", () => {
    const runs = compactActivityRuns([
      seg({ id: "1", startedAt: "2026-04-06T09:00:00+00:00", endedAt: "2026-04-06T09:00:20+00:00", durationSeconds: 20, appName: "Finder" }),
      seg({ id: "2", startedAt: "2026-04-06T09:00:30+00:00", endedAt: "2026-04-06T09:00:50+00:00", durationSeconds: 20, appName: "Notes" }),
    ]);
    expect(formatProjectRunLine(runs[0])).toBe("r0 | 09:00–09:00 (1m) | 2 short activities");
  });
});
