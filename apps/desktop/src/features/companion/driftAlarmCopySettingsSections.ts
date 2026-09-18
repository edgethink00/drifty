import type { DriftAlarmCopySettingsValue } from "./driftAlarmCopy";
import type { TranslationKey } from "../localization/translations";

export type DriftAlarmCopySectionKey = "drift" | "breakReturn" | "notification" | "extremeNudge";

export type DriftAlarmCopyFieldDefinition = {
  readonly key: keyof DriftAlarmCopySettingsValue;
  readonly labelKey: TranslationKey;
  /** Placeholders the template may use, shown beside the field. */
  readonly placeholders: readonly string[];
};

export type DriftAlarmCopyGroup = {
  readonly key: DriftAlarmCopySectionKey;
  readonly fields: readonly DriftAlarmCopyFieldDefinition[];
};

/* Context pills and the no-target/dashboard labels stay fixed: they are cut
   to the capsule's width, so a longer phrase would clip mid-word. */
const DRIFT_COPY_SECTION = {
  key: "drift",
  fields: [
    { key: "driftTitle", labelKey: "settings.alarmCopy.field.title", placeholders: ["{context}", "{driftDuration}"] },
    { key: "driftSummary", labelKey: "settings.alarmCopy.field.summary", placeholders: ["{context}", "{driftDuration}"] },
    { key: "returnToFocusLabel", labelKey: "settings.alarmCopy.field.returnToFocus", placeholders: [] },
    { key: "takeBreakLabel", labelKey: "settings.alarmCopy.field.takeBreak", placeholders: [] },
    { key: "manualCorrectionLabel", labelKey: "settings.alarmCopy.field.manualCorrection", placeholders: [] },
    { key: "petInterceptTitle", labelKey: "settings.alarmCopy.field.petInterceptTitle", placeholders: ["{context}"] },
    { key: "petInterceptSummary", labelKey: "settings.alarmCopy.field.petInterceptSummary", placeholders: ["{context}"] },
  ],
} as const satisfies DriftAlarmCopyGroup;

const BREAK_RETURN_COPY_SECTION = {
  key: "breakReturn",
  fields: [
    { key: "breakReturnTitle", labelKey: "settings.alarmCopy.field.title", placeholders: ["{breakDuration}"] },
    { key: "breakReturnSummary", labelKey: "settings.alarmCopy.field.summary", placeholders: ["{breakDuration}"] },
    { key: "extendBreakLabel", labelKey: "settings.alarmCopy.field.extendBreak", placeholders: [] },
  ],
} as const satisfies DriftAlarmCopyGroup;

const NOTIFICATION_COPY_SECTION = {
  key: "notification",
  fields: [
    { key: "notificationTitle", labelKey: "settings.alarmCopy.field.title", placeholders: [] },
    { key: "notificationBody", labelKey: "settings.alarmCopy.field.notificationBody", placeholders: ["{driftDuration}", "{place}"] },
  ],
} as const satisfies DriftAlarmCopyGroup;

const EXTREME_NUDGE_COPY_SECTION = {
  key: "extremeNudge",
  fields: [
    { key: "extremeNudgeTitle", labelKey: "settings.alarmCopy.field.title", placeholders: ["{closed}"] },
  ],
} as const satisfies DriftAlarmCopyGroup;

export const DRIFT_ALARM_COPY_SECTIONS = [
  DRIFT_COPY_SECTION,
  BREAK_RETURN_COPY_SECTION,
  NOTIFICATION_COPY_SECTION,
  EXTREME_NUDGE_COPY_SECTION,
] as const satisfies readonly DriftAlarmCopyGroup[];

export function selectCopySection(key: DriftAlarmCopySectionKey): DriftAlarmCopyGroup {
  switch (key) {
    case "drift":
      return DRIFT_COPY_SECTION;
    case "breakReturn":
      return BREAK_RETURN_COPY_SECTION;
    case "notification":
      return NOTIFICATION_COPY_SECTION;
    case "extremeNudge":
      return EXTREME_NUDGE_COPY_SECTION;
    default: {
      const exhaustive: never = key;
      return exhaustive;
    }
  }
}

