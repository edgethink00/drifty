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

  it("widens the micro/tiny minute thresholds as the axis compresses below baseline", () => {
    // A 12-minute event sits above the 10-minute tiny cutoff at the baseline
    // 56px/hr height, but at the compressed 42px/hr default (75%) the cutoff
    // widens to ~13.3 minutes, so the same event now collapses to the fixed
    // tiny height instead of overrunning its slot.
    const event = makeWeekCalendarEvent({
      activeDurationMinutes: 12,
      durationMinutes: 12,
      isShort: true,
    });

    const atBaseline = buildWeekCalendarEventLayout(event, 56);
    expect(atBaseline.isTinyEvent).toBe(false);

    const atCompressed = buildWeekCalendarEventLayout(event, 42);
    expect(atCompressed.isTinyEvent).toBe(true);
    expect(atCompressed.eventHeight).toBe(12);
  });

  it("pushes near-micro events to the micro strip once the axis compresses", () => {
    // 3.5 active minutes is tiny (not micro) at baseline, but micro once the
    // 3-minute cutoff widens to ~4 minutes under the compressed default.
    const event = makeWeekCalendarEvent({
      activeDurationMinutes: 3.5,
      durationMinutes: 3.5,
      isShort: true,
    });

    expect(buildWeekCalendarEventLayout(event, 56).isMicroEvent).toBe(false);
    expect(buildWeekCalendarEventLayout(event, 42).isMicroEvent).toBe(true);
  });
});
