import { describe, expect, it } from "vitest";
import { isDriftAlarmEvent } from "./driftAlarmBridge";
import type { DriftAlarmEvent } from "./DriftAlarm";

const focusTarget = {
  targetId: "app:com.microsoft.VSCode",
  label: "VS Code",
  detail: "companion/DriftAlarm.tsx",
  appName: "VS Code",
  bundleId: "com.microsoft.VSCode",
  siteDomain: null,
  siteTitle: null,
  iconSrc: null,
};

const driftEvent = {
  id: "alarm-1",
  mode: "drift",
  breakReturn: null,
  contextLabel: "youtube.com",
  driftDurationLabel: "6 minutes",
  driftDurationSeconds: 360,
  preservedFocusStrikeLabel: "32-minute",
  preservedFocusStrikeSeconds: 1920,
  generatedAt: "2026-05-20T13:16:00.000Z",
  breakOptions: [5, 15, 30, 60],
  focusTargets: [focusTarget],
} satisfies DriftAlarmEvent;

describe("driftAlarmBridge validation", () => {
  it("accepts drift and break-return native payloads", () => {
    const breakReturnEvent = {
      ...driftEvent,
      id: "break-return-15",
      mode: "break_return",
      contextLabel: "YouTube",
      breakReturn: {
        breakDurationMinutes: 15,
        breakDurationLabel: "15m",
        pausedFromLabel: "YouTube",
        nextFocusLabel: "VS Code",
      },
    } satisfies DriftAlarmEvent;

    expect(isDriftAlarmEvent(driftEvent)).toBe(true);
    expect(isDriftAlarmEvent(breakReturnEvent)).toBe(true);
  });

  it("rejects mismatched break-return payload details", () => {
    expect(isDriftAlarmEvent({ ...driftEvent, mode: "break_return", breakReturn: null })).toBe(false);
    expect(isDriftAlarmEvent({
      ...driftEvent,
      mode: "break_return",
      breakReturn: {
        breakDurationMinutes: 15,
        breakDurationLabel: "15m",
        pausedFromLabel: "YouTube",
        nextFocusLabel: "",
      },
    })).toBe(false);
    expect(isDriftAlarmEvent({ ...driftEvent, mode: "drift", breakReturn: { breakDurationMinutes: 15 } })).toBe(false);
  });
});
