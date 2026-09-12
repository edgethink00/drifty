import { describe, expect, it } from "vitest";
import type { ActivitySegment, ClassificationOptions } from "@drifty/domain";
import type { DriftAlarmInteraction } from "../companion/driftAlarmRecoveryTypes";
import { buildAlarmFollowThrough } from "./alarmFollowThrough";

const OPTIONS = {} as ClassificationOptions;
const RANGE = { rangeStart: "2026-09-01T00:00:00.000Z", rangeEnd: "2026-09-08T00:00:00.000Z" };

function focus(id: string, startedAt: string, minutes: number): ActivitySegment {
  const startedMs = new Date(startedAt).getTime();
  return {
    id,
    startedAt,
    endedAt: new Date(startedMs + minutes * 60_000).toISOString(),
    durationSeconds: minutes * 60,
    appName: "Visual Studio Code",
  } as ActivitySegment;
}

function shown(alarmId: string, shownAt: string): DriftAlarmInteraction {
  return { kind: "shown", alarmId, mode: "drift", shownAt, driftDurationSeconds: 900 } as DriftAlarmInteraction;
}

function action(alarmId: string, name: string, actedAt: string): DriftAlarmInteraction {
  return { kind: "action", alarmId, mode: "drift", action: name, actedAt } as unknown as DriftAlarmInteraction;
}

function build(interactions: DriftAlarmInteraction[], segments: ActivitySegment[]) {
  return buildAlarmFollowThrough({ interactions, segments, classificationOptions: OPTIONS, ...RANGE });
}

describe("buildAlarmFollowThrough", () => {
  it("reports nothing when no alarm fired", () => {
    const result = build([], [focus("f", "2026-09-02T09:00:00.000Z", 60)]);
    expect(result.totalAlarms).toBe(0);
    expect(result.rate).toBeNull();
    expect(result.medianMinutesToFocus).toBeNull();
  });

  it("counts every alarm in the denominator, not only the ones with a break", () => {
    const result = build(
      [shown("a", "2026-09-02T09:00:00.000Z"), shown("b", "2026-09-02T14:00:00.000Z")],
      [focus("f", "2026-09-02T09:05:00.000Z", 30)],
    );
    expect(result.totalAlarms).toBe(2);
    expect(result.recoveredAlarms).toBe(1);
    expect(result.rate).toBe(0.5);
  });

  it("credits a return with no button press to the on-your-own path", () => {
    const result = build(
      [shown("a", "2026-09-02T09:00:00.000Z")],
      [focus("f", "2026-09-02T09:07:00.000Z", 20)],
    );
    expect(result.pathCounts).toEqual({ afterBreak: 0, returned: 0, onOwn: 1, noReturn: 0 });
    expect(result.medianMinutesToFocus).toBe(7);
  });

  it("separates the break path from the return-to-focus path", () => {
    const result = build(
      [
        shown("a", "2026-09-02T09:00:00.000Z"),
        action("a", "start_break", "2026-09-02T09:01:00.000Z"),
        shown("b", "2026-09-03T09:00:00.000Z"),
        action("b", "return_to_focus", "2026-09-03T09:01:00.000Z"),
      ],
      [focus("f1", "2026-09-02T09:12:00.000Z", 30), focus("f2", "2026-09-03T09:04:00.000Z", 30)],
    );
    expect(result.pathCounts.afterBreak).toBe(1);
    expect(result.pathCounts.returned).toBe(1);
    expect(result.pathCounts.onOwn).toBe(0);
  });

  it("does not count a focus run shorter than the stated minimum", () => {
    const result = build(
      [shown("a", "2026-09-02T09:00:00.000Z")],
      [focus("f", "2026-09-02T09:05:00.000Z", 4)],
    );
    expect(result.recoveredAlarms).toBe(0);
    expect(result.pathCounts.noReturn).toBe(1);
  });

  it("does not count a return that lands after the stated window", () => {
    const result = build(
      [shown("a", "2026-09-02T09:00:00.000Z")],
      [focus("f", "2026-09-02T09:45:00.000Z", 60)],
    );
    expect(result.recoveredAlarms).toBe(0);
    expect(result.pathCounts.noReturn).toBe(1);
  });


  it("does not treat confirmed drift gaps as focus even when they sit inside a 5-minute merge window", () => {
    const drift = {
      id: "d1",
      startedAt: "2026-09-02T09:01:00.000Z",
      endedAt: "2026-09-02T09:04:00.000Z",
      durationSeconds: 180,
      appName: "Safari",
      siteDomain: "netflix.com",
    } as ActivitySegment;
    const result = build(
      [shown("a", "2026-09-02T09:00:00.000Z")],
      [
        focus("f1", "2026-09-02T09:00:00.000Z", 1),
        drift,
        focus("f2", "2026-09-02T09:04:00.000Z", 2),
        { ...drift, id: "d2", startedAt: "2026-09-02T09:06:00.000Z", endedAt: "2026-09-02T09:09:00.000Z" },
        focus("f3", "2026-09-02T09:09:00.000Z", 1),
      ],
    );
    expect(result.recoveredAlarms).toBe(0);
    expect(result.pathCounts.noReturn).toBe(1);
  });

  it("still qualifies a split focus run whose actual focus union reaches ten minutes", () => {
    const result = build(
      [shown("a", "2026-09-02T09:00:00.000Z")],
      [focus("f1", "2026-09-02T09:05:00.000Z", 6), focus("f2", "2026-09-02T09:12:00.000Z", 5)],
    );
    expect(result.recoveredAlarms).toBe(1);
  });
  it("merges adjacent focus segments so a split run still qualifies", () => {
    const result = build(
      [shown("a", "2026-09-02T09:00:00.000Z")],
      [focus("f1", "2026-09-02T09:05:00.000Z", 6), focus("f2", "2026-09-02T09:11:00.000Z", 6)],
    );
    expect(result.recoveredAlarms).toBe(1);
  });

  it("ignores alarms outside the selected window", () => {
    const result = build(
      [shown("old", "2026-08-01T09:00:00.000Z"), shown("a", "2026-09-02T09:00:00.000Z")],
      [focus("f", "2026-09-02T09:05:00.000Z", 30)],
    );
    expect(result.totalAlarms).toBe(1);
    expect(result.rate).toBe(1);
  });

  it("counts a unique alarm from a click when no shown record exists", () => {
    const result = build(
      [
        action("a", "start_break", "2026-09-02T09:01:00.000Z"),
        action("b", "dismiss", "2026-09-02T14:01:00.000Z"),
      ],
      [focus("f", "2026-09-02T09:12:00.000Z", 30)],
    );
    expect(result.totalAlarms).toBe(2);
    expect(result.pathCounts.afterBreak).toBe(1);
    expect(result.pathCounts.noReturn).toBe(1);
  });

  it("does not double-count an alarm that has both a shown record and a click", () => {
    const result = build(
      [
        shown("a", "2026-09-02T09:00:00.000Z"),
        action("a", "dismiss", "2026-09-02T09:01:00.000Z"),
      ],
      [focus("f", "2026-09-02T09:08:00.000Z", 20)],
    );
    expect(result.totalAlarms).toBe(1);
    expect(result.pathCounts.onOwn).toBe(1);
    expect(result.medianMinutesToFocus).toBe(8);
  });

  it("counts a break outcome as evidence when no shown record exists", () => {
    const result = build(
      [{
        kind: "break_outcome",
        alarmId: "a",
        attemptId: "attempt-a",
        minutes: 5,
        outcome: "recovered",
        sourceLabel: "youtube.com",
        resolvedAt: "2026-09-02T09:06:00.000Z",
      } as DriftAlarmInteraction],
      [focus("f", "2026-09-02T09:12:00.000Z", 20)],
    );
    expect(result.totalAlarms).toBe(1);
    expect(result.pathCounts.onOwn).toBe(1);
  });

  it("takes the median of the recovered alarms only", () => {
    const result = build(
      [
        shown("a", "2026-09-02T09:00:00.000Z"),
        shown("b", "2026-09-03T09:00:00.000Z"),
        shown("c", "2026-09-04T09:00:00.000Z"),
        shown("d", "2026-09-05T09:00:00.000Z"),
      ],
      [
        focus("f1", "2026-09-02T09:02:00.000Z", 15),
        focus("f2", "2026-09-03T09:10:00.000Z", 15),
        focus("f3", "2026-09-04T09:20:00.000Z", 15),
      ],
    );
    expect(result.recoveredAlarms).toBe(3);
    expect(result.medianMinutesToFocus).toBe(10);
    expect(result.pathCounts.noReturn).toBe(1);
  });
});
