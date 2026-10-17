import { describe, expect, it } from "vitest";
import type { ActivityLabelBlock, ActivityLabelBlockCard, ActivityLabelIndex } from "../activity-labels/activityLabelBlocks";
import type { WeekCalendarEvent } from "./weekCalendar";
import { arrangeWeekCardBlocks, weekWorkNameMinHeight } from "./weekCardBlocks";

const DAY = "2026-10-14";
const dayStartMs = new Date(DAY + "T00:00:00").getTime();
const at = (minute: number) => dayStartMs + minute * 60_000;

function event(id: string, top: number, duration: number, extra: Partial<WeekCalendarEvent> = {}): WeekCalendarEvent {
  return {
    id, segmentIds: [id], appName: "Code", category: "work", productivity: "focus",
    startLabel: "", endLabel: "", detailSummary: "", detailTitle: "", sessionCount: 1,
    identities: [{ id: "app:" + id, label: id, appName: id, bundleId: null, browserName: null, siteDomain: null, siteTitle: null, seconds: duration * 60, firstStartMinute: top }],
    hiddenIdentityCount: 0, isGroupedCluster: false, hasMixedCategory: false, hasMixedProductivity: false,
    classificationSource: "rule", aiClassification: false,
    topMinutes: top, activeDurationMinutes: duration, durationMinutes: duration, isShort: false, lane: 0, laneCount: 1,
    ...extra,
  } as WeekCalendarEvent;
}

function card(key: string, from: number, to: number): ActivityLabelBlockCard {
  return { key, title: key + " title", startMs: at(from), endMs: at(to) };
}

/** A block named by its card unless the user hid the name. */
function index(entries: Record<string, { card: ActivityLabelBlockCard | null; hidden?: boolean }>): ActivityLabelIndex {
  const blocks = new Map(Object.entries(entries).map(([id, value]) => [id, {
    key: DAY + ":" + id, day: DAY, startMs: 0, endMs: 0, startMinute: 0, endMinute: 0, segmentIds: [id], recordedSeconds: 600,
    resolution: value.hidden ? { kind: "user", carried: false, record: {
      blockKey: DAY + ":" + id, logicalDay: DAY, source: "user", status: "hidden", title: "", description: "",
      blockStartedAt: "", blockEndedAt: "", segmentIds: [id],
    } } : { kind: "none", needsGeneration: false },
    display: value.card && !value.hidden ? { title: value.card.title, description: "", origin: "ai", status: "ready" } : null,
    card: value.card, otherCards: [], generation: "resolved",
  } as ActivityLabelBlock]));
  return { forSegments: (_day, ids) => blocks.get(ids[0]) ?? null, forRange: () => null };
}

const arrange = (events: WeekCalendarEvent[], idx: ActivityLabelIndex, keepSegmentId: string | null = null) =>
  arrangeWeekCardBlocks(new Map([[DAY, events]]), idx, { startOfDayMinutes: 0, keepSegmentId });

describe("Week blocks with timeline cards", () => {
  const review = card("review", 540, 660);

  it("draws one card's blocks as one block across breaks of at most 10 minutes", () => {
    const result = arrange([event("a", 540, 30), event("b", 580, 30), event("c", 620, 40, { category: "entertainment", activeDurationMinutes: 10 })],
      index({ a: { card: review }, b: { card: review }, c: { card: review } }));
    const [merged] = result.eventsByDay.get(DAY)!;
    expect(result.eventsByDay.get(DAY)).toHaveLength(1);
    expect(merged).toMatchObject({ topMinutes: 540, durationMinutes: 120, segmentIds: ["a", "b", "c"], category: "work" });
    expect(result.names.get(merged.id)).toMatchObject({ label: { display: { title: "review title" } } });
    expect(result.names.get(merged.id)?.label?.members?.map((block) => block.key)).toEqual([DAY + ":a", DAY + ":b", DAY + ":c"]);
  });

  it("starts a new block that names the card again after a longer break", () => {
    const result = arrange([event("a", 540, 30), event("b", 581, 30)], index({ a: { card: review }, b: { card: review } }));
    const [first, second] = result.eventsByDay.get(DAY)!;
    expect(result.eventsByDay.get(DAY)).toHaveLength(2);
    expect(result.names.get(first.id)?.label?.display?.title).toBe("review title");
    expect(result.names.get(second.id)?.label?.display?.title).toBe("review title");
  });

  it("does not restore a hidden name when a longer visible piece of the same card joins it", () => {
    const result = arrange([event("a", 540, 20), event("b", 560, 60)], index({ a: { card: review, hidden: true }, b: { card: review } }));
    const [merged] = result.eventsByDay.get(DAY)!;
    expect(result.names.get(merged.id)?.label?.display).toBeNull();
    expect(result.names.get(merged.id)?.label?.members).toHaveLength(2);
  });

  it("folds a short block into the neighbour it touches, keeping that block's name and colour and listing its card", () => {
    const videos = card("videos", 585, 597);
    const result = arrange([
      event("a", 540, 45),
      event("v", 585, 12, { category: "entertainment", productivity: "drift", activeDurationMinutes: 12 }),
    ], index({ a: { card: card("review", 540, 585) }, v: { card: videos } }));
    const [merged] = result.eventsByDay.get(DAY)!;
    expect(result.eventsByDay.get(DAY)).toHaveLength(1);
    expect(merged).toMatchObject({ topMinutes: 540, durationMinutes: 57, category: "work", productivity: "focus" });
    expect(merged.identities[0].id).toBe("app:a");
    const label = result.names.get(merged.id)?.label;
    expect(label?.display?.title).toBe("review title");
    expect(label?.block.otherCards).toEqual([{ key: "videos", title: "videos title", startMs: at(585), endMs: at(597) }]);
    expect(label?.members?.map((block) => block.key)).toEqual([DAY + ":a"]);
  });

  it("prefers the neighbour of the same card, then the longer one", () => {
    const own = card("own", 600, 700);
    const sameCard = arrange([event("a", 540, 59), event("s", 600, 10), event("b", 611, 60)],
      index({ a: { card: card("other", 540, 599) }, s: { card: own }, b: { card: own } }));
    expect(sameCard.eventsByDay.get(DAY)!.map((item) => item.segmentIds)).toEqual([["a"], ["s", "b"]]);

    const longer = arrange([event("a", 540, 20), event("s", 560, 10), event("b", 571, 60)],
      index({ a: { card: card("x", 540, 560) }, s: { card: null }, b: { card: card("y", 571, 631) } }));
    expect(longer.eventsByDay.get(DAY)!.map((item) => item.segmentIds)).toEqual([["a"], ["s", "b"]]);
  });

  it("does not draw a short block that touches nothing, or a long one with a few recorded minutes, unless it holds the record asked for", () => {
    const blocks = [event("a", 540, 60), event("lone", 640, 10), event("line", 700, 21, { activeDurationMinutes: 3 })];
    const idx = index({ a: { card: review }, lone: { card: card("lone", 640, 650) }, line: { card: null } });
    expect(arrange(blocks, idx).eventsByDay.get(DAY)!.map((item) => item.id)).toEqual(["a"]);
    expect(arrange(blocks, idx, "lone").eventsByDay.get(DAY)!.map((item) => item.id)).toEqual(["a", "lone"]);
  });

  it("keeps a merged block together when the user hid its name", () => {
    const result = arrange([event("a", 540, 30), event("b", 575, 30)], index({ a: { card: review, hidden: true }, b: { card: review, hidden: true } }));
    const [merged] = result.eventsByDay.get(DAY)!;
    expect(result.eventsByDay.get(DAY)).toHaveLength(1);
    expect(result.names.get(merged.id)?.label?.display).toBeNull();
  });

  it("shows a name from the height that holds the icon and one name line inside the borders", () => {
    expect(weekWorkNameMinHeight(16)).toBe(14);
    // At a 19px root the 0.66rem line outgrows the icon.
    expect(weekWorkNameMinHeight(19)).toBeCloseTo(16.04, 2);
  });
});
