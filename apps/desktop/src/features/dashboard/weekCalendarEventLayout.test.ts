import { describe, expect, it } from "vitest";
import type { WeekCalendarEvent } from "./weekCalendar";
import { buildWeekCalendarEventLayout } from "./weekCalendarEventLayout";

function makeWeekCalendarEvent(overrides: Partial<WeekCalendarEvent> = {}): WeekCalendarEvent {
  return {
    id: "event",
    appName: "Chrome, Preview, Finder",
    category: "workspace",
    productivity: "focus",
    startLabel: "11:30 PM",
    endLabel: "12:15 AM",
    detailSummary: "3 captured segments",
    detailTitle: "11:30 PM-12:15 AM",
    sessionCount: 3,
    identities: [],
    hiddenIdentityCount: 0,
    isGroupedCluster: true,
    classificationSource: "rule",
    aiClassification: false,
    topMinutes: 690,
    durationMinutes: 45,
    isShort: false,
    lane: 0,
    laneCount: 1,
    ...overrides,
  };
}

describe("buildWeekCalendarEventLayout", () => {
  it("keeps grouped 45 minute event block height on the timeline scale", () => {
    const layout = buildWeekCalendarEventLayout(makeWeekCalendarEvent(), 56);

    expect(layout.eventHeight).toBe(38);
    expect(layout.isCompactEvent).toBe(false);
    expect(layout.hidesInlineText).toBe(false);
    expect(layout.showsIdentityStrip).toBe(true);
  });

  it("keeps micro events icon-only inside the event boundary", () => {
    const layout = buildWeekCalendarEventLayout(makeWeekCalendarEvent({ durationMinutes: 1, isShort: true }), 56);

    expect(layout.eventHeight).toBe(22);
    expect(layout.isCompactEvent).toBe(true);
    expect(layout.hidesInlineText).toBe(true);
    expect(layout.showsIdentityStrip).toBe(true);
  });
});
