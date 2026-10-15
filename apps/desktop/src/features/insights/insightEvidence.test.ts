import type { ActivityCategory, ActivitySegment, ProductivityLabel } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import { buildInsightEvidence } from "./insightEvidence";
import { buildInsightSourceLists } from "./insightData";

type SegmentInput = {
  readonly id: string;
  readonly start: string;
  readonly minutes: number;
  readonly app?: string;
  readonly bundleId?: string | null;
  readonly domain?: string | null;
  readonly siteTitle?: string | null;
  readonly title?: string;
  readonly category?: ActivityCategory;
  readonly productivity?: ProductivityLabel;
  readonly deviceId?: string;
  readonly seconds?: number;
};

function segment(input: SegmentInput): ActivitySegment {
  const startedAt = `2026-10-${input.start}:00.000`;
  const endMs = new Date(startedAt).getTime() + (input.seconds ?? input.minutes * 60) * 1000;
  return {
    id: input.id,
    startedAt,
    endedAt: new Date(endMs).toISOString(),
    durationSeconds: input.seconds ?? input.minutes * 60,
    appName: input.app ?? "Safari",
    bundleId: input.bundleId === undefined ? "com.apple.Safari" : input.bundleId,
    windowTitle: input.title ?? "Window",
    siteDomain: input.domain ?? null,
    siteTitle: input.siteTitle ?? null,
    platform: "macos",
    source: "nsworkspace",
    ...(input.deviceId ? { deviceId: input.deviceId } : {}),
    classification: {
      category: input.category ?? "entertainment",
      productivity: input.productivity ?? "drift",
      source: "manual",
      confidence: 1,
      reason: "test",
    },
  };
}

const code = { app: "Code", bundleId: "com.example.code", category: "workspace", productivity: "focus" } as const;

const segments: ActivitySegment[] = [
  segment({ id: "code-1", start: "12T09:00", minutes: 40, ...code, title: "a.ts" }),
  segment({ id: "yt-1", start: "12T09:40", minutes: 12, domain: "youtube.com", siteTitle: "Talk" }),
  // A capture gap under the merge window: still the same stretch.
  segment({ id: "yt-2", start: "12T09:52", minutes: 3, seconds: 170, domain: "YouTube.com", siteTitle: "Talk" }),
  segment({ id: "code-2", start: "12T10:00", minutes: 30, ...code, title: "b.ts" }),
  segment({ id: "x-1", start: "12T10:30", minutes: 9, domain: "x.com", siteTitle: "Home", category: "social_media" }),
  segment({ id: "yt-3", start: "13T21:00", minutes: 25, domain: "youtube.com", siteTitle: "Review" }),
  // The same minutes seen on another Mac count once.
  segment({ id: "yt-3-mini", start: "13T21:00", minutes: 25, domain: "youtube.com", siteTitle: "Review", deviceId: "mini" }),
  // A page with no domain groups by its title, case-insensitively.
  segment({ id: "title-1", start: "13T22:00", minutes: 7, siteTitle: "Local Notes" }),
  segment({ id: "title-2", start: "14T08:00", minutes: 4, siteTitle: "local notes" }),
  // Excluded apps never show up as evidence.
  segment({ id: "secret", start: "14T08:10", minutes: 6, app: "1Password", bundleId: "com.1password.1password" }),
];
segments[segments.length - 1] = { ...segments[segments.length - 1]!, exclusionSource: "default" };

describe("insight evidence", () => {
  it("adds every app row's records up to the number on the row", () => {
    const lists = buildInsightSourceLists(segments, "drift");
    expect(lists.apps.length).toBeGreaterThan(2);
    for (const item of lists.apps) {
      const evidence = buildInsightEvidence(segments, { variant: "drift", list: "apps", itemId: item.id }, item, undefined);
      expect(evidence.kind).toBe("records");
      expect({ id: item.id, seconds: evidence.totalSeconds }).toEqual({ id: item.id, seconds: item.seconds });
    }
  });

  it("counts every switch behind a transition row", () => {
    for (const variant of ["drift", "focus"] as const) {
      for (const item of buildInsightSourceLists(segments, variant).topics) {
        const evidence = buildInsightEvidence(segments, { variant, list: "topics", itemId: item.id }, item, undefined);
        expect(evidence.kind === "switches" ? evidence.count : -1).toBe(item.count);
        expect(evidence.totalSeconds).toBe(item.seconds);
      }
    }
  });

  it("merges a stretch on one page, lists newest first and groups by day", () => {
    const item = buildInsightSourceLists(segments, "drift").apps.find((entry) => entry.label === "youtube.com")!;
    const evidence = buildInsightEvidence(segments, { variant: "drift", list: "apps", itemId: item.id }, item, undefined);
    if (evidence.kind !== "records") throw new Error("expected records");
    expect(evidence.days.map((day) => day.dayKey)).toEqual(["2026-10-13", "2026-10-12"]);
    expect(evidence.days[1]!.entries).toHaveLength(1);
    expect(evidence.days[1]!.entries[0]).toMatchObject({ title: "Talk", durationSeconds: 12 * 60 + 170, segmentIds: ["yt-1", "yt-2"] });
    expect(evidence.recordCount).toBe(2);
  });

  it("starts a day at the user's start of day", () => {
    const item = buildInsightSourceLists(segments, "drift").apps.find((entry) => entry.label === "Local Notes")!;
    const evidence = buildInsightEvidence(segments, { variant: "drift", list: "apps", itemId: item.id }, item, undefined, 9 * 60);
    expect(evidence.days.map((day) => day.dayKey)).toEqual(["2026-10-13"]);
  });

  it("shows nothing when the period no longer has the row", () => {
    const item = buildInsightSourceLists(segments, "drift").apps[0]!;
    const evidence = buildInsightEvidence([], { variant: "drift", list: "apps", itemId: item.id }, item, undefined);
    expect(evidence).toMatchObject({ kind: "records", totalSeconds: 0, recordCount: 0, days: [] });
  });
});
