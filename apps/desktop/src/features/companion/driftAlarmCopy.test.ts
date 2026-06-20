// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  buildDefaultDriftAlarmCopy,
  buildDriftAlarmCopy,
  buildExtremeNudgeToastCopy,
} from "./driftAlarmCopy";
import { DRIFT_ALARM_COPY_STORAGE_KEY, persistDriftAlarmCopy, resolveInitialDriftAlarmCopy } from "./driftAlarmCopyStorage";

describe("driftAlarmCopy", () => {
  it("builds default copy from drift and break-return context", () => {
    const driftCopy = buildDriftAlarmCopy(buildDefaultDriftAlarmCopy(), {
      mode: "drift",
      contextLabel: "youtube.com",
      driftDurationLabel: "8 minutes",
      latestFocusLabel: "VS Code",
    });
    const breakReturnCopy = buildDriftAlarmCopy(buildDefaultDriftAlarmCopy(), {
      mode: "break_return",
      breakDurationLabel: "15m",
      pausedFromLabel: "youtube.com",
      nextFocusLabel: "VS Code",
    });

    expect(driftCopy.title).toBe("Let's get you back in flow.");
    expect(driftCopy.summary).toBe("This seems outside your focus flow.");
    expect(driftCopy.contextPills).toEqual(["Now youtube.com", "Latest focus VS Code"]);
    expect(breakReturnCopy.title).toBe("15m Break finished");
    expect(breakReturnCopy.summary).toBe("Break · 15m complete");
    expect(breakReturnCopy.contextPills).toEqual(["Paused from youtube.com", "Next focus VS Code"]);
    expect(buildExtremeNudgeToastCopy(buildDefaultDriftAlarmCopy(), { closedLabel: "youtube.com" }).title).toBe("Closed youtube.com");
  });

  it("applies title templates while keeping supporting alarm copy fixed", () => {
    const copy = buildDriftAlarmCopy({
      ...buildDefaultDriftAlarmCopy(),
      driftTitle: "Back from {context}",
      driftSummary: "{driftDuration} drift on {context}",
      currentContextPill: "Current {context}",
      latestFocusPill: "Last good place {latestFocus}",
      returnToFocusLabel: "Resume now",
      takeBreakLabel: "Start break",
      manualCorrectionLabel: "This was fine",
    }, {
      mode: "drift",
      contextLabel: "x.com",
      driftDurationLabel: "12 minutes",
      latestFocusLabel: "Linear",
    });

    expect(copy.title).toBe("Back from x.com");
    expect(copy.summary).toBe("This seems outside your focus flow.");
    expect(copy.contextPills).toEqual(["Now x.com", "Latest focus Linear"]);
    expect(copy.returnToFocusLabel).toBe("Return to focus");
    expect(copy.breakChoiceLabel).toBe("Take a break");
    expect(copy.manualCorrectionLabel).toBe("Not a drift");
  });

  it("loads only editable string fields from localStorage", () => {
    window.localStorage.setItem(DRIFT_ALARM_COPY_STORAGE_KEY, JSON.stringify({
      driftTitle: "Custom title",
      driftSummary: "Custom summary",
      currentContextPill: "Custom context",
      latestFocusPill: "Custom focus",
      takeBreakLabel: "Start break",
      backToDashboardLabel: "Open dashboard",
      breakReturnTitle: "Resume after {breakDuration}",
      breakReturnSummary: "Custom break summary",
      pausedFromPill: "Custom paused",
      nextFocusPill: "Custom next",
      notificationTitle: "Notification title",
      notificationBody: "Custom notification body",
      extremeNudgeTitle: "Removed {closed}",
      unknown: "ignored",
    }));

    expect(resolveInitialDriftAlarmCopy()).toMatchObject({
      driftTitle: "Custom title",
      driftSummary: "This seems outside your focus flow.",
      currentContextPill: "Now {context}",
      latestFocusPill: "Latest focus {latestFocus}",
      breakReturnTitle: "Resume after {breakDuration}",
      breakReturnSummary: "Break · {breakDuration} complete",
      pausedFromPill: "Paused from {pausedFrom}",
      nextFocusPill: "Next focus {nextFocus}",
      notificationTitle: "Notification title",
      notificationBody: "{driftDuration} on {place}. Take a breath and choose the next action.",
      extremeNudgeTitle: "Removed {closed}",
      takeBreakLabel: "Take a break",
      backToDashboardLabel: "Back to dashboard",
    });
  });

  it("persists fixed supporting copy instead of stale custom values", () => {
    persistDriftAlarmCopy({
      ...buildDefaultDriftAlarmCopy(),
      driftSummary: "Custom summary",
      currentContextPill: "Custom context",
      latestFocusPill: "Custom focus",
      backToDashboardLabel: "Open dashboard",
      extendBreakLabel: "Start break",
      notificationBody: "Custom notification body",
      extremeNudgeTitle: "Removed {closed}",
    });

    expect(JSON.parse(window.localStorage.getItem(DRIFT_ALARM_COPY_STORAGE_KEY) ?? "{}")).toMatchObject({
      driftSummary: "This seems outside your focus flow.",
      currentContextPill: "Now {context}",
      latestFocusPill: "Latest focus {latestFocus}",
      backToDashboardLabel: "Back to dashboard",
      extendBreakLabel: "Extend break",
      notificationBody: "{driftDuration} on {place}. Take a breath and choose the next action.",
      extremeNudgeTitle: "Removed {closed}",
    });
  });
});
