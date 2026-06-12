// @vitest-environment jsdom

import type { ActivitySegment } from "@drifty/domain";
import { afterEach, describe, expect, it } from "vitest";
import type { DriftAlarmEvent } from "./DriftAlarm";
import {
  DRIFT_ALARM_INTERACTION_STORAGE_KEY,
  buildBreakRecoveryAttempt,
  buildBreakRecoveryInsight,
  readDriftAlarmInteractions,
  recordDriftAlarmInteraction,
  resolveBreakRecoveryOutcome,
} from "./driftAlarmRecovery";

const baseDriftSegment: ActivitySegment = {
  id: "youtube-drift",
  startedAt: "2026-06-12T09:00:00.000Z",
  endedAt: "2026-06-12T09:08:00.000Z",
  durationSeconds: 8 * 60,
  appName: "Google Chrome",
  bundleId: "com.google.Chrome",
  windowTitle: "Video - YouTube",
  browserName: "Google Chrome",
  siteDomain: "youtube.com",
  siteTitle: "YouTube",
  platform: "macos",
  source: "accessibility",
  classification: {
    category: "entertainment",
    productivity: "drift",
    source: "manual",
    confidence: 1,
    reason: "test",
  },
};

const focusEvent: DriftAlarmEvent = {
  id: "active:youtube-drift",
  mode: "drift",
  contextLabel: "youtube.com",
  driftDurationLabel: "8m",
  driftDurationSeconds: 8 * 60,
  preservedFocusStrikeLabel: "0m",
  preservedFocusStrikeSeconds: 0,
  generatedAt: "2026-06-12T09:08:00.000Z",
  breakOptions: [5, 15, 30, 60],
  focusTargets: [],
  sourceSegmentId: "youtube-drift",
  breakReturn: null,
};

afterEach(() => {
  window.localStorage.removeItem(DRIFT_ALARM_INTERACTION_STORAGE_KEY);
});

describe("drift alarm break recovery", () => {
  it("builds a break attempt from the alarm source without storing raw window history", () => {
    const attempt = buildBreakRecoveryAttempt({
      action: { type: "start_break", minutes: 15 },
      event: focusEvent,
      segments: [baseDriftSegment],
      startedAtMs: Date.parse("2026-06-12T09:08:30.000Z"),
    });

    expect(attempt).toMatchObject({
      attemptId: "active:youtube-drift:15:1781255310000",
      alarmId: "active:youtube-drift",
      minutes: 15,
      source: {
        kind: "site",
        key: "youtube.com",
        label: "youtube.com",
        category: "entertainment",
      },
    });
    expect(attempt.breakEndsAt).toBe("2026-06-12T09:23:30.000Z");
    expect(attempt.assessmentEndsAt).toBe("2026-06-12T09:33:30.000Z");
  });

  it("classifies same-source drift, shifted drift, pending, and recovered outcomes", () => {
    const attempt = buildBreakRecoveryAttempt({
      action: { type: "start_break", minutes: 15 },
      event: focusEvent,
      segments: [baseDriftSegment],
      startedAtMs: Date.parse("2026-06-12T09:08:30.000Z"),
    });
    const laterShoppingSegment: ActivitySegment = {
      ...baseDriftSegment,
      id: "shopping-drift",
      appName: "Safari",
      bundleId: "com.apple.Safari",
      siteDomain: "amazon.com",
      siteTitle: "Amazon",
      classification: {
        category: "shopping",
        productivity: "drift",
        source: "manual",
        confidence: 1,
        reason: "test",
      },
    };

    expect(
      resolveBreakRecoveryOutcome({
        attempt,
        driftCandidate: { alertKey: "active:youtube", category: "entertainment", segment: baseDriftSegment, sourceSegmentId: "youtube-drift" },
        nowMs: Date.parse("2026-06-12T09:24:00.000Z"),
      }),
    ).toBe("same_drift_continued");
    expect(
      resolveBreakRecoveryOutcome({
        attempt,
        driftCandidate: { alertKey: "active:amazon", category: "shopping", segment: laterShoppingSegment, sourceSegmentId: "shopping-drift" },
        nowMs: Date.parse("2026-06-12T09:24:00.000Z"),
      }),
    ).toBe("drift_shifted");
    expect(
      resolveBreakRecoveryOutcome({
        attempt,
        driftCandidate: null,
        nowMs: Date.parse("2026-06-12T09:28:00.000Z"),
      }),
    ).toBe(null);
    expect(
      resolveBreakRecoveryOutcome({
        attempt,
        driftCandidate: null,
        nowMs: Date.parse("2026-06-12T09:34:00.000Z"),
      }),
    ).toBe("recovered");
  });

  it("persists local interaction events and builds the Trends recovery summary", () => {
    recordDriftAlarmInteraction({
      kind: "action",
      alarmId: "alarm-one",
      mode: "drift",
      action: "return_to_focus",
      actedAt: "2026-06-10T09:00:00.000Z",
    });
    recordDriftAlarmInteraction({
      kind: "action",
      alarmId: "alarm-two",
      mode: "drift",
      action: "start_break",
      minutes: 15,
      actedAt: "2026-06-11T09:00:00.000Z",
    });
    recordDriftAlarmInteraction({
      kind: "break_outcome",
      alarmId: "alarm-two",
      attemptId: "alarm-two:15:1",
      minutes: 15,
      outcome: "recovered",
      sourceLabel: "youtube.com",
      resolvedAt: "2026-06-11T09:25:00.000Z",
    });
    recordDriftAlarmInteraction({
      kind: "break_outcome",
      alarmId: "alarm-old",
      attemptId: "alarm-old:5:1",
      minutes: 5,
      outcome: "same_drift_continued",
      sourceLabel: "x.com",
      resolvedAt: "2026-03-01T09:25:00.000Z",
    });

    const interactions = readDriftAlarmInteractions();
    const summary = buildBreakRecoveryInsight({
      interactions,
      rangeStart: "2026-06-01T00:00:00.000Z",
      rangeEnd: "2026-06-30T23:59:59.999Z",
    });

    expect(summary).toMatchObject({
      actionCounts: {
        return_to_focus: 1,
        start_break: 1,
        manual_correction: 0,
        settings: 0,
        dismiss: 0,
      },
      outcomeCounts: {
        recovered: 1,
        same_drift_continued: 0,
        drift_shifted: 0,
        unknown: 0,
      },
      recoveryRate: 1,
      resolvedBreaks: 1,
      bestBreak: { minutes: 15, recoveryRate: 1, resolvedBreaks: 1 },
    });
  });
});
