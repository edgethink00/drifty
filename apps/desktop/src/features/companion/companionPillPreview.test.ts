import { describe, expect, it } from "vitest";
import {
  COMPANION_MILESTONE_PREVIEW_OPTIONS,
  COMPANION_MOMENT_PREVIEW_OPTIONS,
  buildCompanionMilestonePreview,
  buildCompanionDriftAlarmPreview,
  buildCompanionExtremeNudgePreview,
  buildCompanionReentryPreview,
} from "./companionPillPreview";

describe("companion milestone previews", () => {
  it("covers routine, record, and daily/weekly podium celebration tiers", () => {
    const events = COMPANION_MILESTONE_PREVIEW_OPTIONS.map((option) =>
      buildCompanionMilestonePreview(option.id, 123),
    );

    expect(events.map((event) => event.tier)).toEqual([1, 3, 3, 3, 3, 3, 3, 3]);
    expect(events.map((event) => event.milestoneKind)).toEqual([
      "total",
      "record",
      "rank",
      "rank",
      "rank",
      "rank",
      "rank",
      "rank",
    ]);
    expect(events.map((event) => event.id)).toEqual([
      "companion-preview-focus-1h-123",
      "companion-preview-record-30d-123",
      "companion-preview-daily-rank-3-123",
      "companion-preview-daily-rank-2-123",
      "companion-preview-daily-rank-1-123",
      "companion-preview-weekly-rank-3-123",
      "companion-preview-weekly-rank-2-123",
      "companion-preview-weekly-rank-1-123",
    ]);
  });
});

/* The decision cards previously had no preview at all: they only appeared after
   real drift, so their copy and spacing could not be reviewed on demand. */
describe("companion moment previews", () => {
  it("offers every decision and return moment", () => {
    expect(COMPANION_MOMENT_PREVIEW_OPTIONS.map((option) => option.id)).toEqual([
      "drift-alarm",
      "break-return",
      "extreme-nudge",
      "reentry",
    ]);
  });

  it("builds a drift alarm carrying a focus target to return to", () => {
    const event = buildCompanionDriftAlarmPreview("drift-alarm", 123);

    expect(event.mode).toBe("drift");
    expect(event.breakReturn).toBeNull();
    expect(event.id).toBe("companion-preview-drift-alarm-123");
    expect(event.focusTargets[0]?.label).toBe("VS Code");
    /* The card leads with how long the drift has run, so it must be populated. */
    expect(event.driftDurationLabel).toBeTruthy();
    expect(event.copy?.title).toBeTruthy();
  });

  it("builds a break-over alarm that names the break it is ending", () => {
    const event = buildCompanionDriftAlarmPreview("break-return", 123);

    expect(event.mode).toBe("break_return");
    expect(event.breakReturn?.breakDurationMinutes).toBe(5);
    expect(event.breakReturn?.nextFocusLabel).toBe("VS Code");
  });

  it("builds an extreme nudge that reports what was closed and where focus was", () => {
    const event = buildCompanionExtremeNudgePreview(123);

    expect(event.kind).toBe("extremeNudgeToast");
    expect(event.id).toBe("companion-preview-extreme-nudge-123");
    expect(event.closedLabel).toBe("YouTube");
    expect(event.focusLabel).toBe("VS Code");
    expect(event.breakOptions).toEqual([5, 15, 30, 60]);
  });

  it("builds a re-entry observation without making a sleep claim", () => {
    const event = buildCompanionReentryPreview(123);

    expect(event.kind).toBe("reentry");
    expect(event.awaySeconds).toBe(8 * 3600 + 12 * 60);
    expect(event.title).toBe("Back after 8h 12m");
    expect(`${event.title} ${event.subtitle}`.toLowerCase()).not.toContain("sleep");
    expect(buildCompanionReentryPreview(123, "ko")).toMatchObject({
      title: "8시간 12분 만에 돌아왔어요",
      subtitle: "마지막 활동은 오전 1:18에 끝났어요",
    });
  });
});

/* A milestone headline states the threshold that was crossed, not where the
   clock stands. The figure is what ties the celebration to the actual day. */
describe("milestone stat values", () => {
  it("carries the figure each headline is claiming", () => {
    const stats = COMPANION_MILESTONE_PREVIEW_OPTIONS.map(
      (option) => buildCompanionMilestonePreview(option.id, 123).statSeconds,
    );

    expect(stats).toEqual([
      62 * 60,
      81 * 60,
      4 * 3600 + 48 * 60,
      5 * 3600 + 48 * 60,
      6 * 3600 + 48 * 60,
      13 * 3600 + 12 * 60,
      14 * 3600 + 12 * 60,
      15 * 3600 + 12 * 60,
    ]);
  });

  it("states a figure that actually clears the threshold it celebrates", () => {
    const oneHour = buildCompanionMilestonePreview("focus-1h", 123);

    expect(oneHour.statSeconds).toBeGreaterThanOrEqual(3600);
  });
});
