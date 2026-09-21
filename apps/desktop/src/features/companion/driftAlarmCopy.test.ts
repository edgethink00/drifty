// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDefaultDriftAlarmCopy,
  buildDriftAlarmCopy,
  buildDriftNotificationCopy,
  buildExtremeNudgeToastCopy,
} from "./driftAlarmCopy";
import {
  DRIFT_ALARM_COPY_OVERRIDES_STORAGE_KEY,
  DRIFT_ALARM_COPY_STORAGE_KEY,
  diffDriftAlarmCopyOverrides,
  persistDriftAlarmCopyOverrides,
  resolveDriftAlarmCopy,
  resolveInitialDriftAlarmCopyOverrides,
} from "./driftAlarmCopyStorage";

describe("driftAlarmCopy", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

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

  it("follows the display language for defaults", () => {
    const korean = buildDefaultDriftAlarmCopy("ko");
    const driftCopy = buildDriftAlarmCopy(korean, {
      mode: "drift",
      contextLabel: "youtube.com",
      driftDurationLabel: "8분",
      latestFocusLabel: "VS Code",
    });
    expect(driftCopy.title).toBe("다시 집중으로 돌아가요.");
    expect(driftCopy.returnToFocusLabel).toBe("집중으로 돌아가기");
    expect(driftCopy.breakChoiceLabel).toBe("휴식하기");
    expect(driftCopy.manualCorrectionLabel).toBe("딴짓 아님");
    expect(driftCopy.contextPills).toEqual(["지금 youtube.com", "최근 집중 VS Code"]);
    expect(buildDriftNotificationCopy(korean, { driftDurationLabel: "5분", place: "youtube.com" })).toEqual({
      title: "딴짓 감지",
      body: "youtube.com에서 5분째예요. 잠시 숨 고르고 다음 행동을 골라 보세요.",
    });
    expect(buildExtremeNudgeToastCopy(korean, { closedLabel: "youtube.com" }).title).toBe("youtube.com 닫음");
  });

  it("renders every editable field from the settings", () => {
    const copy = buildDriftAlarmCopy({
      ...buildDefaultDriftAlarmCopy(),
      driftTitle: "Back from {context}",
      driftSummary: "{driftDuration} drift on {context}",
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
    expect(copy.summary).toBe("12 minutes drift on x.com");
    expect(copy.returnToFocusLabel).toBe("Resume now");
    expect(copy.breakChoiceLabel).toBe("Start break");
    expect(copy.manualCorrectionLabel).toBe("This was fine");
  });

  it("stores only overrides and resolves them over the current language", () => {
    const defaults = buildDefaultDriftAlarmCopy("en");
    const overrides = diffDriftAlarmCopyOverrides({
      ...defaults,
      driftTitle: "Back from {context}",
      driftSummary: "   ",
      notificationBody: defaults.notificationBody,
    }, defaults);
    expect(overrides).toEqual({ driftTitle: "Back from {context}" });

    persistDriftAlarmCopyOverrides(overrides);
    expect(JSON.parse(window.localStorage.getItem(DRIFT_ALARM_COPY_OVERRIDES_STORAGE_KEY) ?? "{}")).toEqual({ driftTitle: "Back from {context}" });
    expect(window.localStorage.getItem(DRIFT_ALARM_COPY_STORAGE_KEY)).toBeNull();

    const korean = resolveDriftAlarmCopy(resolveInitialDriftAlarmCopyOverrides(), "ko");
    expect(korean.driftTitle).toBe("Back from {context}");
    expect(korean.driftSummary).toBe("집중 흐름에서 벗어난 것 같아요.");
    expect(korean.returnToFocusLabel).toBe("집중으로 돌아가기");
  });

  it("migrates the legacy full object by keeping only fields that differ from the English defaults", () => {
    window.localStorage.setItem(DRIFT_ALARM_COPY_STORAGE_KEY, JSON.stringify({
      ...buildDefaultDriftAlarmCopy("en"),
      driftTitle: "Custom title",
      breakReturnTitle: "Resume after {breakDuration}",
      notificationTitle: "Notification title",
      extremeNudgeTitle: "Removed {closed}",
      unknown: "ignored",
    }));

    expect(resolveInitialDriftAlarmCopyOverrides()).toEqual({
      driftTitle: "Custom title",
      breakReturnTitle: "Resume after {breakDuration}",
      notificationTitle: "Notification title",
      extremeNudgeTitle: "Removed {closed}",
    });
    // An unedited legacy install picks up the display language wholesale.
    window.localStorage.setItem(DRIFT_ALARM_COPY_STORAGE_KEY, JSON.stringify(buildDefaultDriftAlarmCopy("en")));
    expect(resolveInitialDriftAlarmCopyOverrides()).toEqual({});
    expect(resolveDriftAlarmCopy(resolveInitialDriftAlarmCopyOverrides(), "ko").notificationTitle).toBe("딴짓 감지");
  });

  it("ignores blank, non-string, and unknown override fields", () => {
    window.localStorage.setItem(DRIFT_ALARM_COPY_OVERRIDES_STORAGE_KEY, JSON.stringify({
      driftTitle: "  ",
      takeBreakLabel: 42,
      manualCorrectionLabel: "Keep",
      unknown: "ignored",
    }));
    expect(resolveInitialDriftAlarmCopyOverrides()).toEqual({ manualCorrectionLabel: "Keep" });
  });
});
