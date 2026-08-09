import { buildDefaultDriftAlarmCopy, type DriftAlarmCopySettingsValue } from "./driftAlarmCopy";

export const DRIFT_ALARM_COPY_STORAGE_KEY = "drifty.notifications.driftAlarmCopy";

export function resolveInitialDriftAlarmCopy(): DriftAlarmCopySettingsValue {
  if (typeof window === "undefined") return buildDefaultDriftAlarmCopy();
  const rawValue = window.localStorage.getItem(DRIFT_ALARM_COPY_STORAGE_KEY);
  if (!rawValue) return buildDefaultDriftAlarmCopy();

  try {
    const parsed: unknown = JSON.parse(rawValue);
    return mergeDriftAlarmCopy(parsed);
  } catch (error) {
    if (error instanceof SyntaxError) return buildDefaultDriftAlarmCopy();
    throw error;
  }
}

export function persistDriftAlarmCopy(settings: DriftAlarmCopySettingsValue): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DRIFT_ALARM_COPY_STORAGE_KEY, JSON.stringify(withFixedSupportingCopyDefaults(settings)));
}

function mergeDriftAlarmCopy(value: unknown): DriftAlarmCopySettingsValue {
  const defaults = buildDefaultDriftAlarmCopy();
  if (!value || typeof value !== "object") return defaults;

  return {
    driftTitle: stringField(value, "driftTitle", defaults.driftTitle),
    driftSummary: defaults.driftSummary,
    petInterceptTitle: stringField(value, "petInterceptTitle", defaults.petInterceptTitle),
    petInterceptSummary: defaults.petInterceptSummary,
    currentContextPill: defaults.currentContextPill,
    latestFocusPill: defaults.latestFocusPill,
    returnToFocusLabel: defaults.returnToFocusLabel,
    takeBreakLabel: defaults.takeBreakLabel,
    noFocusTargetLabel: defaults.noFocusTargetLabel,
    backToDashboardLabel: defaults.backToDashboardLabel,
    manualCorrectionLabel: defaults.manualCorrectionLabel,
    breakReturnTitle: stringField(value, "breakReturnTitle", defaults.breakReturnTitle),
    breakReturnSummary: defaults.breakReturnSummary,
    pausedFromPill: defaults.pausedFromPill,
    nextFocusPill: defaults.nextFocusPill,
    extendBreakLabel: defaults.extendBreakLabel,
    notificationTitle: stringField(value, "notificationTitle", defaults.notificationTitle),
    notificationBody: defaults.notificationBody,
    extremeNudgeTitle: stringField(value, "extremeNudgeTitle", defaults.extremeNudgeTitle),
  };
}

function withFixedSupportingCopyDefaults(settings: DriftAlarmCopySettingsValue): DriftAlarmCopySettingsValue {
  const defaults = buildDefaultDriftAlarmCopy();
  return {
    ...settings,
    driftSummary: defaults.driftSummary,
    currentContextPill: defaults.currentContextPill,
    latestFocusPill: defaults.latestFocusPill,
    returnToFocusLabel: defaults.returnToFocusLabel,
    takeBreakLabel: defaults.takeBreakLabel,
    noFocusTargetLabel: defaults.noFocusTargetLabel,
    backToDashboardLabel: defaults.backToDashboardLabel,
    manualCorrectionLabel: defaults.manualCorrectionLabel,
    breakReturnSummary: defaults.breakReturnSummary,
    pausedFromPill: defaults.pausedFromPill,
    nextFocusPill: defaults.nextFocusPill,
    extendBreakLabel: defaults.extendBreakLabel,
    notificationBody: defaults.notificationBody,
  };
}

function stringField(source: object, key: keyof DriftAlarmCopySettingsValue, fallback: string): string {
  const entry = Object.entries(source).find(([entryKey]) => entryKey === key);
  return typeof entry?.[1] === "string" ? entry[1] : fallback;
}
