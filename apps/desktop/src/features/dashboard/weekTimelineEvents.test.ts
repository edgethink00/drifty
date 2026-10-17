import { describe, expect, it } from "vitest";
import { activityBlockLabelKey, storedActivityTimelineCards, ACTIVITY_TIMELINE_CARD_PROMPT_VERSION, buildFlowBlocks, type ActivitySegment, type ActivityTimelineWindowRecord, type ActivityBlockLabelRecord } from "@drifty/domain";
import { buildActivityLabelBlocks, buildActivityLabelIndex } from "../activity-labels/activityLabelBlocks";
import { buildFlowBlockHoverGroups } from "../flow-chart/flowHoverGroups";
import { buildWeekCalendarEvents } from "./weekCalendar";
import { arrangeWeekCardBlocks } from "./weekCardBlocks";
import { buildWeekTimelineEvents, splitWeekTimelineRanges } from "./weekTimelineEvents";

const DAY = "2026-10-14";
const at = (time: string) => new Date(`${DAY}T${time}:00`).toISOString();
const record = (id: string, from: string, to: string, extra: Partial<ActivitySegment> = {}): ActivitySegment => ({
  id, startedAt: at(from), endedAt: at(to), durationSeconds: (Date.parse(at(to)) - Date.parse(at(from))) / 1000,
  appName: "Code", platform: "macos", source: "nsworkspace", ...extra,
});
function windowOf(ids: string[], ...ranges: [string, string, string][]): ActivityTimelineWindowRecord {
  return {
    windowKey: DAY + ":window", logicalDay: DAY, language: "en", promptVersion: ACTIVITY_TIMELINE_CARD_PROMPT_VERSION,
    startedAt: at(ranges[0][1]), endedAt: at(ranges[ranges.length - 1][2]), createdAt: at("18:00"),
    cards: ranges.map(([title, from, to], position) => ({
      position, title, description: "", startedAt: at(from), endedAt: at(to), segmentIds: ids, status: "ready", variant: "strict",
    })),
  };
}
function model(segments: ActivitySegment[], windows: ActivityTimelineWindowRecord[], labels: ActivityBlockLabelRecord[] = [], startOfDayMinutes = 0) {
  const legacy = buildWeekCalendarEvents(segments, DAY, DAY, 0, 24, undefined, startOfDayMinutes);
  const events = buildWeekTimelineEvents(legacy, segments, storedActivityTimelineCards(windows, "en"), { startOfDayMinutes });
  const blocks = buildActivityLabelBlocks(events, {
    segmentsById: new Map(segments.map(s => [s.id, s])), labels, windows, startOfDayMinutes, language: "en", nowMs: Date.parse(at("18:00")),
  });
  const index = buildActivityLabelIndex(blocks, new Map(segments.map(s => [s.id, s])));
  return { legacy, events, blocks, index, arranged: arrangeWeekCardBlocks(events, index, { startOfDayMinutes }) };
}

describe("Week timeline card geometry", () => {
  it("keeps a continuous Day hover's task and other cards when each owns fewer than half its records", () => {
    const segments = [record("a", "09:00", "09:40"), record("b", "09:40", "10:20"), record("c", "10:20", "11:00")];
    const result = model(segments, [
      windowOf(["a"], ["Checkout review", "09:00", "09:40"]),
      windowOf(["b"], ["Figure review", "09:40", "10:20"]),
      windowOf(["c"], ["Release notes", "10:20", "11:00"]),
    ].map((window, i) => ({ ...window, windowKey: DAY + ":window:" + i })));
    const group = buildFlowBlockHoverGroups(buildFlowBlocks(segments, DAY, 3), 3, 0, new Map(segments.map(s => [s.id, s]))).get(540)!;
    expect([group.startMinuteOfDay, group.endMinuteOfDay, group.displaySegmentIds?.length]).toEqual([540, 660, 3]);
    const label = result.index.forRange(DAY, 540, 660, group.displaySegmentIds!);
    expect(label?.display?.title).toBe("Checkout review");
    expect(label?.otherCards.map(c => c.title)).toEqual(["Figure review", "Release notes"]);
  });

  it("ranks actual shared seconds above capture count and clips a long record to the hover", () => {
    const segments = [record("long", "09:00", "10:00"), ...Array.from({ length: 6 }, (_, i) => record(String(i), "10:00", "10:01"))];
    const result = model(segments, [windowOf(["long"], ["Deep work", "09:00", "10:00"]),
      { ...windowOf(segments.slice(1).map(s => s.id), ["Quick checks", "10:00", "10:01"]), windowKey: DAY + ":short" }]);
    const ids = segments.map(s => s.id);
    expect(result.index.forRange(DAY, 540, 601, ids)?.display?.title).toBe("Deep work");
    expect(result.index.forRange(DAY, 599, 601, ids)?.display?.title).toBe("Quick checks");
    expect(result.index.forRange(DAY, 540, 601, ["unrelated"])).toBeNull();
    expect(result.index.forRange(DAY, 601, 610, ids)).toBeNull();
  });

  it("keeps a hidden dominant Day task hidden rather than choosing its visible runner-up", () => {
    const segments = [record("a", "09:00", "10:00"), record("b", "10:00", "10:30")];
    const windows = [windowOf(["a", "b"], ["Deep work", "09:00", "10:00"], ["Quick review", "10:00", "10:30"])];
    const first = model(segments, windows).blocks[0];
    const hidden: ActivityBlockLabelRecord = { blockKey: first.key, source: "user", status: "hidden", logicalDay: DAY,
      blockStartedAt: at("09:00"), blockEndedAt: at("10:00"), segmentIds: ["a"], title: "", description: "" };
    const label = model(segments, windows, [hidden]).index.forRange(DAY, 540, 630, ["a", "b"]);
    expect(label?.resolution.kind).toBe("user");
    expect(label?.display).toBeNull();
    expect(label?.otherCards.map(c => c.title)).toEqual(["Quick review"]);
    const second = model(segments, windows).blocks[1];
    const hideOther = { ...hidden, blockKey: second.key, blockStartedAt: at("10:00"), blockEndedAt: at("10:30"), segmentIds: ["b"] };
    expect(model(segments, windows, [hideOther]).index.forRange(DAY, 540, 630, ["a", "b"])?.otherCards).toEqual([]);
  });

  it("uses exact card edges, even when two cards share a long record", () => {
    const segments = [record("long", "09:00", "10:00")];
    const result = model(segments, [windowOf(["long"], ["Checkout review", "09:00", "09:31"], ["Figure review", "09:31", "10:00"])]);
    const events = result.events.get(DAY)!;
    expect(events.map(e => [e.topMinutes, e.durationMinutes])).toEqual([[540, 31], [571, 29]]);
    expect(new Set(result.blocks.map(b => b.key)).size).toBe(2);
    expect(events.map(e => result.index.forSegments(DAY, e.segmentIds, e)?.display?.title)).toEqual(["Checkout review", "Figure review"]);
    expect(events[0].identities[0].seconds).toBeCloseTo(31 * 60);
    expect(events[1].identities[0].seconds).toBeCloseTo(29 * 60);
    expect([...result.arranged.names.values()].map(name => name.label?.display?.title)).toEqual(["Checkout review", "Figure review"]);
    expect(result.index.forRange(DAY, 540, 600, ["long"])?.otherCards.map(c => c.title)).toEqual(["Figure review"]);
  });

  it("keeps the old display exactly without usable cards or with conflicting cards", () => {
    const segments = [record("a", "09:00", "10:00")];
    const empty = model(segments, []);
    expect(empty.events).toEqual(empty.legacy);
    const conflict = model(segments, [windowOf(["a"], ["First", "09:00", "09:45"], ["Second", "09:30", "10:00"])]);
    expect(conflict.events).toEqual(conflict.legacy);
    expect(buildWeekTimelineEvents(empty.legacy, segments, storedActivityTimelineCards([windowOf(["a"], ["Other language", "09:00", "10:00"])], "ko"), { startOfDayMinutes: 0 })).toEqual(empty.legacy);
  });

  it("does not assign a card to records it does not own, and preserves record membership in the fallback", () => {
    const segments = [record("a", "09:00", "09:30"), record("b", "09:30", "10:00")];
    const result = model(segments, [windowOf(["a"], ["Checkout review", "09:00", "09:45"])]);
    const fallback = result.events.get(DAY)!.find(e => !e.timelineCardKey)!;
    expect(fallback.segmentIds).toEqual(["b"]);
    expect(result.index.forSegments(DAY, fallback.segmentIds, fallback)?.card).toBeNull();
    expect(fallback.activeDurationMinutes).toBe(30);
  });

  it("keeps 10-minute breaks together and separates any longer break, including inside a card", () => {
    expect(splitWeekTimelineRanges([{ start: 0, end: 60_000 }, { start: 660_000, end: 720_000 }])).toEqual([{ start: 0, end: 720_000 }]);
    expect(splitWeekTimelineRanges([{ start: 0, end: 60_000 }, { start: 660_001, end: 720_000 }])).toHaveLength(2);
    const result = model([record("a", "09:00", "09:30"), record("b", "09:41", "10:11")], [windowOf(["a", "b"], ["Checkout review", "09:00", "10:11"])]);
    expect(result.arranged.eventsByDay.get(DAY)).toHaveLength(2);
  });

  it("carries a hidden legacy block into every covered card, without leaking a range choice to another slice", () => {
    const segments = [record("a", "09:00", "09:30"), record("b", "09:30", "10:00")];
    const windows = [windowOf(["a", "b"], ["Checkout review", "09:00", "09:30"], ["Figure review", "09:30", "10:00"])];
    const hidden: ActivityBlockLabelRecord = {
      blockKey: activityBlockLabelKey(DAY, ["a", "b"]), source: "user", status: "hidden", logicalDay: DAY,
      blockStartedAt: at("09:00"), blockEndedAt: at("10:00"), segmentIds: ["a", "b"], title: "", description: "",
    };
    expect(model(segments, windows, [hidden]).blocks.every(b => b.resolution.kind === "user" && !b.display)).toBe(true);
    const long = [record("long", "09:00", "10:00")];
    const shared = [windowOf(["long"], ["Checkout review", "09:00", "09:30"], ["Figure review", "09:30", "10:00"])];
    const first = model(long, shared).blocks[0];
    const choice = { ...hidden, blockKey: first.key, segmentIds: ["long"], blockEndedAt: at("09:30") };
    expect(model(long, shared, [choice]).blocks.map(b => b.display?.title ?? null)).toEqual([null, "Figure review"]);
    const newer = [{ ...shared[0], cards: shared[0].cards.map(c => ({ ...c, title: c.title + " updated" })) }];
    expect(model(long, newer, [choice]).blocks.map(b => b.display?.title ?? null)).toEqual([null, "Figure review updated"]);
  });

  it("keeps B's isolated short-card rule and reveals its exact contributing record from History", () => {
    const result = model([record("short", "12:00", "12:10")], [windowOf(["short"], ["Figure review", "12:00", "12:10"])]);
    expect(result.arranged.eventsByDay.get(DAY)).toEqual([]);
    const revealed = arrangeWeekCardBlocks(result.events, result.index, { startOfDayMinutes: 0, keepSegmentId: "short" });
    expect(revealed.eventsByDay.get(DAY)?.[0].segmentIds).toEqual(["short"]);
    expect([...revealed.names.values()][0].label?.display?.title).toBe("Figure review");
  });

  it("does not expose excluded records through a stored card", () => {
    const segments = [record("private", "09:00", "10:00", { exclusionSource: "user" })];
    const result = model(segments, [windowOf(["private"], ["Old title", "09:00", "10:00"])]);
    expect(result.events).toEqual(result.legacy);
    expect(result.events.get(DAY)!.every(e => !e.timelineCardKey)).toBe(true);
  });

  it("retains the existing fixed-clock representation on a daylight-saving transition day", () => {
    const previous = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const day = "2026-11-01";
      const segments = [{ ...record("dst", "09:00", "10:00"), startedAt: `${day}T09:00:00-05:00`, endedAt: `${day}T10:00:00-05:00` }];
      const stored = { ...windowOf(["dst"], ["Checkout review", "09:00", "10:00"]), logicalDay: day,
        cards: [{ ...windowOf(["dst"], ["Checkout review", "09:00", "10:00"]).cards[0], startedAt: segments[0].startedAt, endedAt: segments[0].endedAt }] };
      const legacy = buildWeekCalendarEvents(segments, day, day, 0, 24);
      expect(legacy.get(day)).not.toHaveLength(0);
      expect(buildWeekTimelineEvents(legacy, segments, storedActivityTimelineCards([stored], "en"), { startOfDayMinutes: 0 })).toEqual(legacy);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
