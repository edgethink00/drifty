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
    activeDurationMinutes: 45,
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
    expect(layout.isMicroEvent).toBe(false);
    expect(layout.isTinyEvent).toBe(false);
    expect(layout.showsIdentityStrip).toBe(true);
  });

  it("renders micro events as color-only strips", () => {
    const layout = buildWeekCalendarEventLayout(makeWeekCalendarEvent({
      activeDurationMinutes: 1,
      durationMinutes: 1,
      isShort: true,
    }), 56);

    expect(layout.eventHeight).toBe(6);
    expect(layout.isCompactEvent).toBe(true);
    expect(layout.hidesInlineText).toBe(true);
    expect(layout.isMicroEvent).toBe(true);
    expect(layout.isTinyEvent).toBe(true);
    expect(layout.showsIdentityStrip).toBe(false);
  });

  it("renders active time under ten minutes as a short text-only block", () => {
    const layout = buildWeekCalendarEventLayout(makeWeekCalendarEvent({
      activeDurationMinutes: 8,
      durationMinutes: 21,
      isShort: true,
    }), 56);

    expect(layout.eventHeight).toBe(12);
    expect(layout.isCompactEvent).toBe(true);
    expect(layout.hidesInlineText).toBe(false);
    expect(layout.isMicroEvent).toBe(false);
    expect(layout.isTinyEvent).toBe(true);
    expect(layout.showsIdentityStrip).toBe(false);
  });
});
