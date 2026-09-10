import { describe, expect, it } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import { buildInsightsCoachReadiness } from "./insightsReadiness";

function segment(id: string, startedAt: string, durationSeconds: number): ActivitySegment {
  const startedMs = new Date(startedAt).getTime();
  return {
    id,
    startedAt,
    endedAt: Number.isNaN(startedMs) ? startedAt : new Date(startedMs + durationSeconds * 1000).toISOString(),
    durationSeconds,
    appName: "Visual Studio Code",
  } as ActivitySegment;
}

function fullDay(day: string, hours: number): ActivitySegment[] {
  return [segment(`${day}-a`, `${day}T09:00:00.000Z`, hours * 3600)];
}

describe("buildInsightsCoachReadiness", () => {
  it("stays locked with no activity", () => {
    const readiness = buildInsightsCoachReadiness([]);
    expect(readiness.isReady).toBe(false);
    expect(readiness.trackedHours).toBe(0);
    expect(readiness.meaningfulDays).toBe(0);
    expect(readiness.progress).toBe(0);
  });

  it("does not count a day that carries less than two classified hours", () => {
    const readiness = buildInsightsCoachReadiness([
      ...fullDay("2026-09-01", 1.5),
      ...fullDay("2026-09-02", 1.5),
      ...fullDay("2026-09-03", 1.5),
    ]);
    expect(readiness.meaningfulDays).toBe(0);
    expect(readiness.isReady).toBe(false);
  });

  it("refuses to unlock on hours alone when they sit inside too few days", () => {
    const readiness = buildInsightsCoachReadiness([
      ...fullDay("2026-09-01", 20),
      ...fullDay("2026-09-02", 10),
    ]);
    expect(readiness.trackedHours).toBe(30);
    expect(readiness.meaningfulDays).toBe(2);
    expect(readiness.hoursProgress).toBe(1);
    expect(readiness.isReady).toBe(false);
    // The slower gate drives the reported progress.
    expect(readiness.progress).toBeCloseTo(2 / 3, 5);
  });

  it("refuses to unlock on days alone when the hours are thin", () => {
    const readiness = buildInsightsCoachReadiness([
      ...fullDay("2026-09-01", 3),
      ...fullDay("2026-09-02", 3),
      ...fullDay("2026-09-03", 3),
    ]);
    expect(readiness.meaningfulDays).toBe(3);
    expect(readiness.daysProgress).toBe(1);
    expect(readiness.isReady).toBe(false);
  });

  it("unlocks once both gates clear", () => {
    const readiness = buildInsightsCoachReadiness([
      ...fullDay("2026-09-01", 9),
      ...fullDay("2026-09-02", 8),
      ...fullDay("2026-09-03", 8),
    ]);
    expect(readiness.trackedHours).toBe(25);
    expect(readiness.meaningfulDays).toBe(3);
    expect(readiness.isReady).toBe(true);
    expect(readiness.progress).toBe(1);
  });

  it("ignores unusable segments instead of inflating progress", () => {
    const readiness = buildInsightsCoachReadiness([
      segment("bad-date", "not-a-date", 7200),
      segment("zero", "2026-09-01T09:00:00.000Z", 0),
      segment("negative", "2026-09-01T09:00:00.000Z", -3600),
    ]);
    expect(readiness.trackedHours).toBe(0);
    expect(readiness.meaningfulDays).toBe(0);
  });
});
