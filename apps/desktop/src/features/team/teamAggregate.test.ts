import type { ActivitySegment } from "@drifty/domain";
import { describe, expect, it } from "vitest";

import { buildTeamFocusAggregate, getTeamFocusWindow } from "./teamAggregate";

function makeActivity(overrides: Partial<ActivitySegment>): ActivitySegment {
  return {
    id: "activity-1",
    startedAt: "2026-07-01T10:00:00",
    endedAt: "2026-07-01T11:00:00",
    durationSeconds: 60 * 60,
    appName: "Code",
    platform: "macos",
    source: "manual",
    classification: {
      category: "workspace",
      productivity: "focus",
      source: "manual",
      confidence: 1,
    },
    ...overrides,
  };
}

describe("teamAggregate", () => {
  it("Given weekly local activity When aggregate is built Then it returns safe publish fields with the exact focus score formula", () => {
    // Given
    const localActivity = [
      makeActivity({
        id: "focus-crossing-window-start",
        startedAt: "2026-06-26T03:30:00",
        endedAt: "2026-06-26T04:30:00",
        durationSeconds: 60 * 60,
      }),
      makeActivity({
        id: "focus-inside-window",
        startedAt: "2026-07-01T10:00:00",
        endedAt: "2026-07-01T11:00:00",
        durationSeconds: 60 * 60,
      }),
      makeActivity({
        id: "neutral-inside-window",
        startedAt: "2026-07-01T12:00:00",
        endedAt: "2026-07-01T12:30:00",
        durationSeconds: 30 * 60,
        classification: {
          category: "utility",
          productivity: "neutral",
          source: "manual",
          confidence: 1,
        },
      }),
      makeActivity({
        id: "drift-inside-window",
        startedAt: "2026-07-02T01:00:00",
        endedAt: "2026-07-02T01:30:00",
        durationSeconds: 30 * 60,
        classification: {
          category: "entertainment",
          productivity: "drift",
          source: "manual",
          confidence: 1,
        },
      }),
      makeActivity({
        id: "outside-window",
        startedAt: "2026-06-26T03:00:00",
        endedAt: "2026-06-26T03:30:00",
        durationSeconds: 30 * 60,
      }),
    ];

    // When
    const result = buildTeamFocusAggregate({
      localActivity,
      period: "weekly",
      windowEndDay: "2026-07-02",
      displayName: "Alex",
      roleLabel: "Builder",
      timezone: "Asia/Seoul",
      startOfDayMinutes: 4 * 60,
      includeAiClassifications: false,
    });

    // Then
    expect(result).toEqual({
      success: true,
      error: null,
      data: {
        period: "weekly",
        display_name: "Alex",
        role_label: "Builder",
        focus_seconds: 90 * 60,
        focus_score: 60,
        active_seconds: 150 * 60,
        window_start_date: "2026-06-26",
        window_end_date: "2026-07-02",
        timezone: "Asia/Seoul",
      },
    });
  });

  it("Given empty activity When daily aggregate is built Then zero active seconds produces a zero focus score", () => {
    // Given
    const localActivity: ActivitySegment[] = [];

    // When
    const result = buildTeamFocusAggregate({
      localActivity,
      period: "daily",
      windowEndDay: "2026-07-02",
      displayName: "",
      roleLabel: "",
      timezone: "UTC",
      startOfDayMinutes: 0,
      includeAiClassifications: true,
    });

    // Then
    expect(result).toEqual({
      success: true,
      error: null,
      data: {
        period: "daily",
        display_name: "Drifty member",
        role_label: "Member",
        focus_seconds: 0,
        focus_score: 0,
        active_seconds: 0,
        window_start_date: "2026-07-02",
        window_end_date: "2026-07-02",
        timezone: "UTC",
      },
    });
  });

  it("Given every team period When focus windows are requested Then daily weekly and monthly ranges are supported", () => {
    // Given
    const windowEndDay = "2026-07-02";

    // When
    const daily = getTeamFocusWindow("daily", windowEndDay);
    const weekly = getTeamFocusWindow("weekly", windowEndDay);
    const monthly = getTeamFocusWindow("monthly", windowEndDay);

    // Then
    expect(daily).toEqual({ period: "daily", window_start_date: "2026-07-02", window_end_date: "2026-07-02" });
    expect(weekly).toEqual({ period: "weekly", window_start_date: "2026-06-26", window_end_date: "2026-07-02" });
    expect(monthly).toEqual({ period: "monthly", window_start_date: "2026-06-03", window_end_date: "2026-07-02" });
  });

  it("Given an unsupported period When aggregate is built Then it returns a typed invalid-period failure", () => {
    // Given
    const localActivity: ActivitySegment[] = [];

    // When
    const result = buildTeamFocusAggregate({
      localActivity,
      period: "yearly",
      windowEndDay: "2026-07-02",
      displayName: "Alex",
      roleLabel: "Builder",
      timezone: "UTC",
      startOfDayMinutes: 0,
      includeAiClassifications: true,
    });

    // Then
    expect(result).toEqual({
      success: false,
      error: "Unsupported team focus period.",
      reason: "invalid_period",
    });
  });
});
