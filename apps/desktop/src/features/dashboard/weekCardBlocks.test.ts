import { describe, expect, it } from "vitest";
import type { ActivityLabelBlock, ActivityLabelBlockCard, ActivityLabelIndex } from "../activity-labels/activityLabelBlocks";
import type { WeekCalendarEvent } from "./weekCalendar";
import { arrangeWeekCardBlocks, clearsShortBar, LONE_BLOCK_SHARE, weekWorkNameMinHeight } from "./weekCardBlocks";

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

const arrange = (events: WeekCalendarEvent[], idx: ActivityLabelIndex, keepSegmentId: string | null = null, loneBlockShare?: number) =>
  arrangeWeekCardBlocks(new Map([[DAY, events]]), idx, { startOfDayMinutes: 0, keepSegmentId, loneBlockShare });

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

  it("keeps a short block that touches nothing for Your Day from 40% of the short bar, and still folds one that touches a neighbour", () => {
    const blocks = [
      event("a", 540, 60), event("touch", 601, 5), event("lone", 640, 6), event("line", 700, 21, { activeDurationMinutes: 2 }),
      event("minute", 760, 1), event("five", 800, 5), event("thin", 840, 10, { activeDurationMinutes: 1 }),
    ];
    const idx = index({ a: { card: review }, touch: { card: null }, lone: { card: card("lone", 640, 646) }, line: { card: null }, minute: { card: null }, five: { card: null }, thin: { card: null } });
    const day = arrange(blocks, idx, null, LONE_BLOCK_SHARE).eventsByDay.get(DAY)!;
    // 6 minutes with 2 recorded clear 40% of 14 and 4; a minute, 5 minutes, or 1 recorded minute do not.
    expect(day.map((item) => item.segmentIds)).toEqual([["a", "touch"], ["lone"], ["line"]]);
    expect(clearsShortBar(6, 2, LONE_BLOCK_SHARE)).toBe(true);
    expect(clearsShortBar(5, 5, LONE_BLOCK_SHARE)).toBe(false);
    expect(clearsShortBar(13, 1, LONE_BLOCK_SHARE)).toBe(false);
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

describe("Your Day blocks across naming windows", () => {
  const named = (key: string, title: string, from: number, to: number): ActivityLabelBlockCard => ({ key, title, startMs: at(from), endMs: at(to) });
  const site = (id: string, top: number, duration: number, domain: string, extra: Partial<WeekCalendarEvent> = {}) => event(id, top, duration, {
    category: "entertainment", productivity: "drift",
    identities: [{ id: "site:" + domain, label: domain, appName: "Aside", bundleId: null, browserName: "Aside", siteDomain: domain, siteTitle: null, seconds: duration * 60, firstStartMinute: top }],
    ...extra,
  });

  it("joins blocks of the same name from two windows a short break apart", () => {
    const result = arrange([event("a", 600, 16), event("b", 621, 37)], index({
      a: { card: named("w1:c3", "OpenFront play", 600, 616) },
      b: { card: named("w2:c1", "OpenFront play", 621, 658) },
    }));
    expect(result.eventsByDay.get(DAY)).toHaveLength(1);
    expect(result.eventsByDay.get(DAY)![0]).toMatchObject({ topMinutes: 600, durationMinutes: 58 });
  });

  it("continues passive browsing of one site past a window edge and names the stretch by the site", () => {
    const result = arrange([site("a", 600, 40, "youtube.com"), site("b", 640, 55, "youtube.com"), site("c", 696, 54, "youtube.com")], index({
      a: { card: named("w1:c1", "Funny rankings", 600, 640) },
      b: { card: named("w2:c1", "Food and gaming Shorts", 640, 695) },
      c: { card: named("w3:c1", "Music and esports clips", 696, 750) },
    }));
    const blocks = result.eventsByDay.get(DAY)!;
    expect(blocks).toHaveLength(1);
    const name = result.names.get(blocks[0].id)!;
    // The first card names it only for now; the block asks for a name of its own from its cards.
    expect(name.others).toBe(2);
    expect(name.retitle?.cards.map((part) => part.title)).toEqual(["Funny rankings", "Food and gaming Shorts", "Music and esports clips"]);
  });

  it("keeps different work in one app apart at a window edge", () => {
    const work = (id: string, top: number, duration: number) => event(id, top, duration, {
      identities: [{ id: "app:chatgpt", label: "ChatGPT", appName: "ChatGPT", bundleId: null, browserName: null, siteDomain: null, siteTitle: null, seconds: duration * 60, firstStartMinute: top }],
    });
    const result = arrange([work("a", 600, 40), work("b", 640, 40)], index({
      a: { card: named("w1:c1", "Public server and rebuttal threads", 600, 640) },
      b: { card: named("w2:c1", "Reviewer draft structure", 640, 680) },
    }));
    expect(result.eventsByDay.get(DAY)).toHaveLength(2);
  });

  it("joins a window edge when the titles are mostly the same words", () => {
    const doc = (id: string, top: number, duration: number) => site(id, top, duration, "docs.google.com", { category: "workspace", productivity: "focus" });
    const result = arrange([doc("a", 480, 30), doc("b", 510, 39)], index({
      a: { card: named("w1:c2", "Drifty YC Winter 2027 application", 480, 510) },
      b: { card: named("w2:c1", "Drifty YC application", 510, 549) },
    }));
    const blocks = result.eventsByDay.get(DAY)!;
    expect(blocks).toHaveLength(1);
    // A title worded like the name is the name, not another activity.
    expect(result.names.get(blocks[0].id)?.others).toBeUndefined();
  });

  it("never folds the lock screen into an activity", () => {
    const locked = event("l", 646, 12, {
      category: "unknown", productivity: "neutral", activeDurationMinutes: 3,
      identities: [{ id: "app:com.apple.loginwindow", label: "loginwindow", appName: "loginwindow", bundleId: "com.apple.loginwindow", browserName: null, siteDomain: null, siteTitle: null, seconds: 180, firstStartMinute: 646 }],
    });
    const result = arrange([event("a", 600, 46), locked], index({ a: { card: named("w1:c1", "OpenFront play", 600, 646) }, l: { card: null } }), null, LONE_BLOCK_SHARE);
    const blocks = result.eventsByDay.get(DAY)!;
    expect(blocks.map((block) => [block.topMinutes, block.durationMinutes])).toEqual([[600, 46], [646, 12]]);
  });

  it("counts the other activities when they hold half or more of a block", () => {
    const result = arrange([
      event("a", 540, 20, { category: "communication" }),
      event("b", 560, 8, { category: "entertainment", activeDurationMinutes: 8 }),
      event("c", 568, 7, { category: "entertainment", activeDurationMinutes: 7 }),
      event("d", 575, 6, { category: "entertainment", activeDurationMinutes: 6 }),
    ], index({
      a: { card: named("w1:c1", "Aside meeting", 540, 560) },
      b: { card: named("w2:c1", "OpenFront and YouTube", 560, 568) },
      c: { card: named("w2:c2", "OpenFront play", 568, 575) },
      d: { card: named("w2:c3", "YouTube and LinkedIn", 575, 581) },
    }));
    const [block] = result.eventsByDay.get(DAY)!;
    const name = result.names.get(block.id)!;
    expect(name.label?.display?.title).toBe("Aside meeting");
    expect(name.others).toBe(3);
    expect(name.retitled).toBeUndefined();
  });
  it("leaves the count out while the name covers most of the block", () => {
    const result = arrange([
      event("a", 540, 33, { category: "communication" }),
      event("b", 573, 8, { category: "entertainment", activeDurationMinutes: 8 }),
      event("c", 581, 7, { category: "entertainment", activeDurationMinutes: 7 }),
    ], index({
      a: { card: named("w1:c1", "Aside meeting", 540, 573) },
      b: { card: named("w2:c1", "OpenFront and YouTube", 573, 581) },
      c: { card: named("w2:c2", "OpenFront play", 581, 588) },
    }));
    const [block] = result.eventsByDay.get(DAY)!;
    expect(result.names.get(block.id)?.others).toBeUndefined();
  });
  it("calls a merged block by its stored name, without the count or one card's description", () => {
    const events = [site("a", 600, 40, "youtube.com"), site("b", 640, 55, "youtube.com"), site("c", 696, 54, "youtube.com")];
    const idx = index({
      a: { card: named("w1:c1", "Funny rankings", 600, 640) },
      b: { card: named("w2:c1", "Food and gaming Shorts", 640, 695) },
      c: { card: named("w3:c1", "Music and esports clips", 696, 750) },
    });
    const key = arrange(events, idx).names.get(arrange(events, idx).eventsByDay.get(DAY)![0].id)!.retitle!.key;
    const stored = new Map([[key, "YouTube Shorts and esports clips"]]);
    const result = arrangeWeekCardBlocks(new Map([[DAY, events]]), idx, { startOfDayMinutes: 0, mergedTitles: { language: "", get: (k) => stored.get(k) } });
    const name = result.names.get(result.eventsByDay.get(DAY)![0].id)!;
    expect(name.label?.display).toMatchObject({ title: "YouTube Shorts and esports clips", description: "" });
    expect(name.retitled).toBe(true);
    expect(name.others).toBeUndefined();
  });
});

