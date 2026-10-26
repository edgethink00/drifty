import { describe, expect, it } from "vitest";
import { ACTIVITY_TIMELINE_CARD_PROMPT_VERSION, storedActivityTimelineCards, type ActivitySegment } from "@drifty/domain";
import { buildWeekCalendarEvents } from "./weekCalendar";
import { buildWeekActivityInspectorEvent } from "./weekActivityInspectorEvent";
import { buildWeekTimelineEvents } from "./weekTimelineEvents";
import { arrangeWeekCardBlocks } from "./weekCardBlocks";
import { buildActivityLabelIndex } from "../activity-labels/activityLabelBlocks";

const day = "2026-10-21";
const row = (id: string, start: string, end: string, durationSeconds: number, extra: Partial<ActivitySegment> = {}): ActivitySegment => ({
  id, startedAt: start, endedAt: end, durationSeconds, appName: "Owned Editor", platform: "windows", source: "accessibility", ...extra,
});
const local = (time: string) => new Date(`2026-10-22T${time}`).getTime();

function inspect(segments: ActivitySegment[]) {
  const legacy = buildWeekCalendarEvents(segments, day, day, 0, 24, undefined, 240);
  const timeline = buildWeekTimelineEvents(legacy, segments, [], { startOfDayMinutes: 240 });
  const arranged = arrangeWeekCardBlocks(timeline, buildActivityLabelIndex([], new Map(segments.map(s => [s.id, s]))), {
    startOfDayMinutes: 240, keepSegmentId: "1",
  });
  return arranged.eventsByDay.get(day)!.map(event => buildWeekActivityInspectorEvent(event,
    new Map(segments.map(s => [s.id, s])), new Map(), new Map(), { day, boundaryMinutes: 240 }));
}

describe("Week evidence uses the actual contributing intervals", () => {
  it("keeps the saved seconds before a rounded History reveal without changing its credited time", () => {
    // Native Windows fixture: 01:11:34.644 -> 01:12:44.790, 75 credited seconds.
    // The calendar rounds its drawn start to 01:12; saved frames at :41/:51
    // still belong to the selected record. A guessed one-minute pad is unsafe.
    const segment = row("1", "2026-10-22T01:11:34.644", "2026-10-22T01:12:44.790", 75);
    const [event] = inspect([segment]);
    expect(event.startLabel).toContain("1:12");
    expect(event.durationSeconds).toBe(120);
    expect(segment.durationSeconds).toBe(75);
    expect(event.screenEvidenceSelection).toEqual({ recordIds: ["1"], windows: [[local("01:11:34.644"), local("01:12:49.644")]] });
    for (const captured of [local("01:11:41"), local("01:11:51")]) {
      expect(event.screenEvidenceSelection!.windows.some(([start, end]) => start <= captured && captured < end)).toBe(true);
    }
  });

  it("keeps gaps between folded records and does not substitute a remote record", () => {
    const segments = [row("1", "2026-10-22T01:11:34", "2026-10-22T01:12:34", 60),
      row("2", "2026-10-22T01:13:34", "2026-10-22T01:14:34", 60),
      row("3", "2026-10-22T01:12:34", "2026-10-22T01:13:34", 60, { deviceId: "other-computer" })];
    const [event] = inspect(segments);
    expect(event.screenEvidenceSelection).toEqual({ recordIds: ["1", "2"], windows: [
      [local("01:11:34"), local("01:12:34")], [local("01:13:34"), local("01:14:34")],
    ] });
  });

  it("does not borrow the adjacent card's seconds when both cards share one long record", () => {
    const segment = row("1", "2026-10-22T01:00:00", "2026-10-22T02:00:00", 3600);
    const legacy = buildWeekCalendarEvents([segment], day, day, 0, 24, undefined, 240);
    const cards = storedActivityTimelineCards([{
      windowKey: "owned-window", logicalDay: day, language: "en", promptVersion: ACTIVITY_TIMELINE_CARD_PROMPT_VERSION,
      startedAt: segment.startedAt, endedAt: segment.endedAt!, createdAt: segment.endedAt!,
      cards: [["First", "01:00:00", "01:31:00"], ["Second", "01:31:00", "02:00:00"]].map(([title, start, end], position) => ({
        position, title, description: "", startedAt: new Date(local(start)).toISOString(), endedAt: new Date(local(end)).toISOString(),
        segmentIds: ["1"], status: "ready" as const, variant: "strict" as const,
      })),
    }], "en");
    const events = buildWeekTimelineEvents(legacy, [segment], cards, { startOfDayMinutes: 240 }).get(day)!;
    expect(events).toHaveLength(2);
    const selections = events.map(event => buildWeekActivityInspectorEvent(event, new Map([["1", segment]]), new Map(), new Map(),
      { day, boundaryMinutes: 240 }).screenEvidenceSelection);
    expect(selections.map(selection => selection?.windows)).toEqual([
      [[local("01:00:00"), local("01:31:00")]], [[local("01:31:00"), local("02:00:00")]],
    ]);
  });

  it("preserves both real DST occurrences without filling the hour between them", () => {
    const previous = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const foldDay = "2026-11-01";
      const segments = [row("1", `${foldDay}T01:10:34-04:00`, `${foldDay}T01:20:34-04:00`, 600),
        row("2", `${foldDay}T01:10:34-05:00`, `${foldDay}T01:20:34-05:00`, 600)];
      const [event] = buildWeekCalendarEvents(segments, foldDay, foldDay, 0, 24).get(foldDay)!;
      expect(buildWeekActivityInspectorEvent(event, new Map(segments.map(s => [s.id, s])), new Map(), new Map(),
        { day: foldDay, boundaryMinutes: 0 }).screenEvidenceSelection?.windows).toEqual(segments.map(s => [Date.parse(s.startedAt), Date.parse(s.endedAt!)]));
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it("retains the original fractional edge in an unnamed remainder beside a stored card", () => {
    const segment = row("1", "2026-10-22T01:11:34", "2026-10-22T01:50:44", 2350);
    const legacy = buildWeekCalendarEvents([segment], day, day, 0, 24, undefined, 240);
    const cards = storedActivityTimelineCards([{
      windowKey: "partial-window", logicalDay: day, language: "en", promptVersion: ACTIVITY_TIMELINE_CARD_PROMPT_VERSION,
      startedAt: segment.startedAt, endedAt: segment.endedAt!, createdAt: segment.endedAt!,
      cards: [{ position: 0, title: "Middle card", description: "", startedAt: new Date(local("01:30:00")).toISOString(),
        endedAt: new Date(local("01:45:00")).toISOString(), segmentIds: ["1"], status: "ready", variant: "strict" }],
    }], "en");
    const events = buildWeekTimelineEvents(legacy, [segment], cards, { startOfDayMinutes: 240 }).get(day)!;
    const windows = events.map(event => buildWeekActivityInspectorEvent(event, new Map([["1", segment]]), new Map(), new Map(),
      { day, boundaryMinutes: 240 }).screenEvidenceSelection?.windows);
    expect(windows).toEqual([[[local("01:11:34"), local("01:30:00")]],
      [[local("01:30:00"), local("01:45:00")]], [[local("01:45:00"), local("01:50:44")]]]);
  });
});
