import { describe, expect, it } from "vitest";
import { laneCardPlaces, type LaneItem } from "./yourDayLaneNotes";
import type { WeekCalendarEvent } from "./weekCalendar";

// A 600px lane is 25px an hour: one 16px line needs 38.4 minutes.
const H = 600;
function item(id: string, from: number, to: number, recorded = to - from): LaneItem {
  return {
    event: { id, durationMinutes: to - from, activeDurationMinutes: recorded } as WeekCalendarEvent,
    top: from, bottom: to, drawnTop: from, drawnBottom: to, title: id, description: null, named: true, origin: undefined,
    tone: "#000", timeLabel: "", clockRange: "", hoverTitle: id, openMinute: from,
  };
}
const named = (places: ReturnType<typeof laneCardPlaces>) => places.filter((place) => place.height >= 16).map((place) => place.item.event.id);

describe("Your Day lane card places", () => {
  it("lets a short card between long ones borrow the top of the next, whose text moves down", () => {
    const places = laneCardPlaces([item("long-a", 540, 600), item("short", 600, 615), item("long-b", 615, 690)], H);
    expect(named(places)).toEqual(["long-a", "short", "long-b"]);
    const [, short, next] = places;
    expect(short).toMatchObject({ borrowing: true, height: 16, top: 250 });
    expect(next.contentOffset).toBeCloseTo(16 - 15 / 60 * 25);
    expect(next.top).toBeCloseTo(615 / 60 * 25);
  });
  it("borrows only from a next card that keeps a line of its own", () => {
    const places = laneCardPlaces([item("long-a", 540, 600), item("short", 600, 615), item("medium", 615, 655)], H);
    expect(places[1].borrowing).toBe(false);
    expect(named(places)).toEqual(["long-a", "medium"]);
  });
  it("keeps the first of two short cards in a row out, and a lone minute out", () => {
    const run = laneCardPlaces([item("long-a", 540, 600), item("s1", 600, 620), item("s2", 620, 640), item("long-b", 640, 720)], H);
    expect(named(run)).toEqual(["long-a", "s2", "long-b"]);
    const minute = laneCardPlaces([item("long-a", 540, 600), item("blip", 600, 601, 1), item("long-b", 601, 700)], H);
    expect(named(minute)).toEqual(["long-a", "long-b"]);
  });
});
