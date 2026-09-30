// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import {
  buildCompanionFocusRunRecordBaseline,
  evaluateCompanionFocusRunRecords,
  initializeCompanionFocusRunRecords,
} from "./companionFocusRunMilestones";

function segment(
  id: string,
  day: number,
  startHour: number,
  durationMinutes: number,
  productivity: "focus" | "neutral" | "drift" = "focus",
  appName = "VS Code",
): ActivitySegment {
  const startedAt = new Date(2026, 6, day, startHour, 0, 0);
  return {
    id,
    startedAt: startedAt.toISOString(),
    endedAt: new Date(startedAt.getTime() + durationMinutes * 60_000).toISOString(),
    durationSeconds: durationMinutes * 60,
    appName,
    platform: "macos",
    source: "nsworkspace",
    classification: {
      category: productivity === "focus" ? "workspace" : "communication",
      productivity,
      source: "manual",
      confidence: 1,
      reason: "Test",
    },
  };
}

describe("Companion focus-run records", () => {
  it("treats consecutive Focus apps as one run", () => {
    const baseline = buildCompanionFocusRunRecordBaseline({
      segments: [
        segment("code", 20, 9, 30, "focus", "VS Code"),
        segment("figma", 20, 9.5, 25, "focus", "Figma"),
      ],
      day: "2026-07-20",
      startOfDayMinutes: 0,
    });

    expect(baseline.bestSeconds.record7d).toBe(55 * 60);
  });

  it("breaks a run when an observed non-Focus segment sits between apps", () => {
    const baseline = buildCompanionFocusRunRecordBaseline({
      segments: [
        segment("code", 20, 9, 30),
        segment("messages", 20, 9.5, 5, "neutral", "Messages"),
        segment("figma", 20, 10, 25, "focus", "Figma"),
      ],
      day: "2026-07-20",
      startOfDayMinutes: 0,
    });

    expect(baseline.bestSeconds.record7d).toBe(30 * 60);
  });

  it("does not count old Windows capture failures as tracked days or a break in a focus run", () => {
    const failedDuringRun: ActivitySegment = {
      ...segment("failed-run", 20, 9.5, 2, "neutral", "Unavailable"),
      platform: "windows",
      source: "unknown",
      bundleId: null,
    };
    const failedOnlyDay: ActivitySegment = {
      ...segment("failed-day", 19, 9, 3, "neutral", "Unavailable"),
      platform: "windows",
      source: "unknown",
      bundleId: null,
    };
    const baseline = buildCompanionFocusRunRecordBaseline({
      segments: [
        segment("code", 20, 9, 30),
        failedDuringRun,
        segment("figma", 20, 9.5, 25),
        failedOnlyDay,
      ],
      day: "2026-07-20",
      startOfDayMinutes: 0,
    });

    expect(baseline.bestSeconds.record7d).toBe(55 * 60);
    expect(baseline.trackedDays.record7d).toBe(1);
  });

  it("emits only the longest newly beaten window", () => {
    const baseline = {
      bestSeconds: { record7d: 40 * 60, record14d: 45 * 60, record30d: 50 * 60 },
      trackedDays: { record7d: 7, record14d: 14, record30d: 20 },
    } as const;
    const progress = initializeCompanionFocusRunRecords("2026-07-20", 39 * 60, baseline);
    const result = evaluateCompanionFocusRunRecords({
      progress,
      day: "2026-07-20",
      currentRunSeconds: 51 * 60,
      trackedDays: baseline.trackedDays,
      announce: true,
    });

    expect(result.events.map((event) => event.title)).toEqual(["Longest focus in 30 days"]);
  });

  it("requires 4, 7 and 14 tracked days before 7-, 14- and 30-day claims", () => {
    const baseline = {
      bestSeconds: { record7d: 30 * 60, record14d: 30 * 60, record30d: 30 * 60 },
      trackedDays: { record7d: 3, record14d: 6, record30d: 13 },
    } as const;
    const progress = initializeCompanionFocusRunRecords("2026-07-20", 29 * 60, baseline);
    const result = evaluateCompanionFocusRunRecords({
      progress,
      day: "2026-07-20",
      currentRunSeconds: 31 * 60,
      trackedDays: baseline.trackedDays,
      announce: true,
    });

    expect(result.events).toEqual([]);

    const eligible = evaluateCompanionFocusRunRecords({
      progress,
      day: "2026-07-20",
      currentRunSeconds: 31 * 60,
      trackedDays: { record7d: 4, record14d: 7, record30d: 14 },
      announce: true,
    });

    expect(eligible.events.map((event) => event.title)).toEqual(["Longest focus in 30 days"]);
  });

  it("announces each record window only once in one run", () => {
    const baseline = {
      bestSeconds: { record7d: 30 * 60, record14d: 90 * 60, record30d: 120 * 60 },
      trackedDays: { record7d: 7, record14d: 14, record30d: 20 },
    } as const;
    const progress = initializeCompanionFocusRunRecords("2026-07-20", 29 * 60, baseline);
    const crossed = evaluateCompanionFocusRunRecords({
      progress,
      day: "2026-07-20",
      currentRunSeconds: 31 * 60,
      trackedDays: baseline.trackedDays,
      announce: true,
    });
    const nextTick = evaluateCompanionFocusRunRecords({
      progress: crossed.progress,
      day: "2026-07-20",
      currentRunSeconds: 32 * 60,
      trackedDays: baseline.trackedDays,
      announce: true,
    });

    expect(crossed.events).toHaveLength(1);
    expect(nextTick.events).toEqual([]);
  });

  it("announces a record that is beaten by one second", () => {
    const baseline = {
      bestSeconds: { record7d: 60 * 60, record14d: 90 * 60, record30d: 120 * 60 },
      trackedDays: { record7d: 7, record14d: 14, record30d: 20 },
    } as const;
    const progress = initializeCompanionFocusRunRecords("2026-07-20", 59 * 60, baseline);

    const result = evaluateCompanionFocusRunRecords({
      progress,
      day: "2026-07-20",
      currentRunSeconds: 60 * 60 + 1,
      trackedDays: baseline.trackedDays,
      announce: true,
    });

    expect(result.events.map((event) => event.title)).toEqual(["Longest focus in 7 days"]);
  });
});
