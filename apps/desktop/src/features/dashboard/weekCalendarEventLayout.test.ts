import { describe, expect, it } from "vitest";
import type { WeekCalendarEvent } from "./weekCalendar";
import { buildWeekCalendarEventLayout, planWeekIdentityStrip } from "./weekCalendarEventLayout";

function makeWeekCalendarEvent(overrides: Partial<WeekCalendarEvent> = {}): WeekCalendarEvent {
  return {
    id: "event",
    segmentIds: ["segment-1", "segment-2", "segment-3"],
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
    hasMixedCategory: true,
    hasMixedProductivity: false,
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

  it("widens the micro/tiny minute thresholds for loose short blocks as the axis compresses", () => {
    // A 12-minute non-grouped block sits above the 10-minute tiny cutoff at the
    // baseline 56px/hr height, but at the compressed 42px/hr default (75%) the
    // cutoff widens to ~13.3 minutes, so the same block now collapses to the
    // fixed tiny height instead of overrunning its slot.
    const event = makeWeekCalendarEvent({
      activeDurationMinutes: 12,
      durationMinutes: 12,
      isShort: true,
      isGroupedCluster: false,
    });

    const atBaseline = buildWeekCalendarEventLayout(event, 56);
    expect(atBaseline.isTinyEvent).toBe(false);

    const atCompressed = buildWeekCalendarEventLayout(event, 42);
    expect(atCompressed.isTinyEvent).toBe(true);
    expect(atCompressed.eventHeight).toBe(12);
  });

  it("pushes near-micro loose short blocks to the micro strip once the axis compresses", () => {
    // 3.5 active minutes is tiny (not micro) at baseline, but micro once the
    // 3-minute cutoff widens to ~4 minutes under the compressed default.
    const event = makeWeekCalendarEvent({
      activeDurationMinutes: 3.5,
      durationMinutes: 3.5,
      isShort: true,
      isGroupedCluster: false,
    });

    expect(buildWeekCalendarEventLayout(event, 56).isMicroEvent).toBe(false);
    expect(buildWeekCalendarEventLayout(event, 42).isMicroEvent).toBe(true);
  });

  it("exempts grouped clusters from the axis-compression collapse so identity strips survive", () => {
    // Grouped clusters carry the identity strip and get their own taller
    // short-height floor, so the compression widening must not sweep them into
    // the tiny bucket and hide their icons. A 12-minute cluster stays above the
    // unscaled 10-minute cutoff at both the baseline and the compressed default.
    const event = makeWeekCalendarEvent({
      activeDurationMinutes: 12,
      durationMinutes: 12,
      isShort: true,
      isGroupedCluster: true,
    });

    const atCompressed = buildWeekCalendarEventLayout(event, 42);
    expect(atCompressed.isTinyEvent).toBe(false);
    expect(atCompressed.showsIdentityStrip).toBe(true);
  });

  it("shows grouped time and detail only when their rows fit beside the identity strip", () => {
    const oneHour = buildWeekCalendarEventLayout(makeWeekCalendarEvent({
      activeDurationMinutes: 60,
      durationMinutes: 60,
      sessionCount: 1,
      isShort: false,
    }), 42);
    expect(oneHour.eventHeight).toBe(38);
    expect(oneHour.isCompactEvent).toBe(false);
    expect(oneHour.showsIdentityStrip).toBe(true);
    expect(oneHour.showsInlineDetail).toBe(false);

    const taller = buildWeekCalendarEventLayout(makeWeekCalendarEvent({
      activeDurationMinutes: 76,
      durationMinutes: 76,
      sessionCount: 1,
      isShort: false,
    }), 42);
    expect(taller.eventHeight).toBeGreaterThanOrEqual(49);
    expect(taller.showsInlineDetail).toBe(true);
  });

  it("keeps grouped row visibility stable at the exact height boundaries", () => {
    const layoutAtHeight = (durationMinutes: number) => buildWeekCalendarEventLayout(makeWeekCalendarEvent({
      activeDurationMinutes: durationMinutes,
      durationMinutes,
      sessionCount: 1,
      isShort: false,
    }), 60);

    const belowTimeThreshold = layoutAtHeight(40);
    expect(belowTimeThreshold.eventHeight).toBe(36);
    expect(belowTimeThreshold.isCompactEvent).toBe(true);

    const atTimeThreshold = layoutAtHeight(41);
    expect(atTimeThreshold.eventHeight).toBe(37);
    expect(atTimeThreshold.isCompactEvent).toBe(false);
    expect(atTimeThreshold.showsInlineDetail).toBe(false);

    const belowDetailThreshold = layoutAtHeight(52);
    expect(belowDetailThreshold.eventHeight).toBe(48);
    expect(belowDetailThreshold.showsInlineDetail).toBe(false);

    const atDetailThreshold = layoutAtHeight(53);
    expect(atDetailThreshold.eventHeight).toBe(49);
    expect(atDetailThreshold.showsInlineDetail).toBe(true);
  });

  it("renders an ungrouped card's time and detail lines only when they fit under its name", () => {
    // At 60px per hour an ungrouped card is duration - 4px tall.
    const layoutAtHeight = (durationMinutes: number) => buildWeekCalendarEventLayout(makeWeekCalendarEvent({
      activeDurationMinutes: durationMinutes,
      durationMinutes,
      sessionCount: 1,
      isGroupedCluster: false,
      isShort: false,
    }), 60);

    const belowTimeThreshold = layoutAtHeight(41);
    expect(belowTimeThreshold.eventHeight).toBe(37);
    expect(belowTimeThreshold.isCompactEvent).toBe(true);

    const atTimeThreshold = layoutAtHeight(42);
    expect(atTimeThreshold.eventHeight).toBe(38);
    expect(atTimeThreshold.isCompactEvent).toBe(false);
    expect(atTimeThreshold.showsInlineDetail).toBe(false);

    const belowDetailThreshold = layoutAtHeight(54);
    expect(belowDetailThreshold.eventHeight).toBe(50);
    expect(belowDetailThreshold.showsInlineDetail).toBe(false);

    const atDetailThreshold = layoutAtHeight(55);
    expect(atDetailThreshold.eventHeight).toBe(51);
    expect(atDetailThreshold.showsInlineDetail).toBe(true);
  });

  it("needs taller cards for each line when a wide window raises the root font size to 19px", () => {
    // At 60px per hour a card is duration - 4px tall. The rem-sized lines are
    // 19/16 as tall as at the base root, so both thresholds move up.
    const expectLayout = (
      durationMinutes: number,
      isGroupedCluster: boolean,
      expected: { eventHeight: number; isCompactEvent?: boolean; showsInlineDetail?: boolean },
    ) => {
      const { eventHeight, ...flags } = expected;
      const layout = buildWeekCalendarEventLayout(
        makeWeekCalendarEvent({
          activeDurationMinutes: durationMinutes,
          durationMinutes,
          sessionCount: 1,
          isGroupedCluster,
          isShort: false,
        }),
        60,
        19,
      );
      expect(layout.eventHeight).toBeCloseTo(eventHeight, 6);
      expect(layout).toMatchObject(flags);
    };

    // Ungrouped: name + time need 42.6px, and with the detail 58.0px.
    expectLayout(46, false, { eventHeight: 42, isCompactEvent: true });
    expectLayout(47, false, { eventHeight: 43, isCompactEvent: false, showsInlineDetail: false });
    expectLayout(62, false, { eventHeight: 58, showsInlineDetail: false });
    expectLayout(63, false, { eventHeight: 59, showsInlineDetail: true });

    // Grouped: strip + time need 38.7px, and with the detail 53.0px.
    expectLayout(42, true, { eventHeight: 38, isCompactEvent: true });
    expectLayout(43, true, { eventHeight: 39, isCompactEvent: false, showsInlineDetail: false });
    expectLayout(57, true, { eventHeight: 53, showsInlineDetail: false });
    expectLayout(58, true, { eventHeight: 54, showsInlineDetail: true });
  });

  it("falls back to the 16px root thresholds when the root font size is unusable", () => {
    const event = makeWeekCalendarEvent({ sessionCount: 1, isGroupedCluster: false, activeDurationMinutes: 42, durationMinutes: 42 });
    for (const rootFontSizePx of [Number.NaN, 0, -4]) {
      expect(buildWeekCalendarEventLayout(event, 60, rootFontSizePx)).toEqual(buildWeekCalendarEventLayout(event, 60, 16));
    }
    expect(buildWeekCalendarEventLayout(event, 60, 16).isCompactEvent).toBe(false);
  });
});

describe("planWeekIdentityStrip", () => {
  it("keeps the model's icons and count when the column is wide enough", () => {
    // 160px column: 4 icons + "+N" chip fit comfortably.
    expect(planWeekIdentityStrip(4, 2, 160)).toEqual({ visibleCount: 4, hiddenCount: 2, tilePx: 18, gapPx: 3 });
  });

  it("keeps all icons without a chip when nothing is hidden and they fit", () => {
    expect(planWeekIdentityStrip(4, 0, 120)).toEqual({ visibleCount: 4, hiddenCount: 0, tilePx: 18, gapPx: 3 });
  });

  it("drops icons into the +N chip when the squished column cannot fit them", () => {
    // 120px column: 31px chrome leaves 89px; 4 icons + chip need 106px but
    // 3 icons + a one-digit chip fit at 85px — at full size.
    expect(planWeekIdentityStrip(4, 2, 120)).toEqual({ visibleCount: 3, hiddenCount: 3, tilePx: 18, gapPx: 3 });
  });

  it("prefers dropping to two full-size icons over shrinking three", () => {
    // 110px column: available 79px; 3 icons + chip need 85px at full size, so
    // show 2 icons + "+2" (64px) at the regular tile size instead.
    expect(planWeekIdentityStrip(4, 0, 110)).toEqual({ visibleCount: 2, hiddenCount: 2, tilePx: 18, gapPx: 3 });
  });

  it("shrinks the tiles continuously, only as far as this strip needs", () => {
    // 88px column: available 57px; even 2 icons + chip need 64px at full size,
    // so the tiles drop just to 17px (2×17 + 2 + 2 + 19 = 57px fits in 57px), no further.
    expect(planWeekIdentityStrip(4, 0, 88)).toEqual({ visibleCount: 2, hiddenCount: 2, tilePx: 17, gapPx: 2 });
  });

  it("keeps small strips at full size even in narrow columns", () => {
    // Same 110px column: 3 icons with no chip (60px) fit without shrinking.
    expect(planWeekIdentityStrip(3, 0, 110)).toEqual({ visibleCount: 3, hiddenCount: 0, tilePx: 18, gapPx: 3 });
    // 77px column: a two-icon strip (39px ≤ 46px) needs no shrink either.
    expect(planWeekIdentityStrip(2, 0, 77)).toEqual({ visibleCount: 2, hiddenCount: 0, tilePx: 18, gapPx: 3 });
  });

  it("always keeps at least two icons, bottoming out at the 13px tile", () => {
    expect(planWeekIdentityStrip(4, 1, 60)).toEqual({ visibleCount: 2, hiddenCount: 3, tilePx: 13, gapPx: 2 });
    expect(planWeekIdentityStrip(2, 1, 60)).toEqual({ visibleCount: 2, hiddenCount: 1, tilePx: 13, gapPx: 2 });
  });

  it("reserves a wider chip for double-digit hidden counts", () => {
    // 130px column: available 99px; 4 icons + a one-digit chip need 106px,
    // 3 icons + a two-digit chip fit at 90px.
    expect(planWeekIdentityStrip(4, 9, 130)).toEqual({ visibleCount: 3, hiddenCount: 10, tilePx: 18, gapPx: 3 });
  });

  it("falls back to the model values without a usable measurement", () => {
    expect(planWeekIdentityStrip(4, 2, null)).toEqual({ visibleCount: 4, hiddenCount: 2, tilePx: 18, gapPx: 3 });
    expect(planWeekIdentityStrip(4, 2, 0)).toEqual({ visibleCount: 4, hiddenCount: 2, tilePx: 18, gapPx: 3 });
    expect(planWeekIdentityStrip(0, 0, 120)).toEqual({ visibleCount: 0, hiddenCount: 0, tilePx: 18, gapPx: 3 });
  });
});
