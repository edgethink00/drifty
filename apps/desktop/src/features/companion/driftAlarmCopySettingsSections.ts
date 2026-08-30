import type { DriftAlarmCopySettingsValue } from "./driftAlarmCopy";

export type DriftAlarmCopySectionKey = "drift" | "breakReturn" | "notification" | "extremeNudge";

export type DriftAlarmCopyField = {
  readonly key: keyof DriftAlarmCopySettingsValue;
  readonly label: string;
  readonly hint: string;
};

export type DriftAlarmCopyGroup = {
  readonly key: DriftAlarmCopySectionKey;
  readonly title: string;
  readonly description: string;
  readonly fields: readonly DriftAlarmCopyField[];
};

const DRIFT_COPY_SECTION = {
  key: "drift",
  title: "Drift alert",
  description: "Shown by Companion when drift is detected.",
  fields: [
    { key: "driftTitle", label: "Title", hint: "{context}" },
  ],
} as const satisfies DriftAlarmCopyGroup;

const BREAK_RETURN_COPY_SECTION = {
  key: "breakReturn",
  title: "Break over",
  description: "Shown by Companion when a selected break ends.",
  fields: [
    { key: "breakReturnTitle", label: "Title", hint: "{breakDuration}" },
  ],
} as const satisfies DriftAlarmCopyGroup;

const NOTIFICATION_COPY_SECTION = {
  key: "notification",
  title: "macOS notification",
  description: "Shown by macOS when Drifty sends a background drift notification.",
  fields: [
    { key: "notificationTitle", label: "Title", hint: "Plain text" },
  ],
} as const satisfies DriftAlarmCopyGroup;

const EXTREME_NUDGE_COPY_SECTION = {
  key: "extremeNudge",
  title: "Automatic close",
  description: "Shown after Drifty closes a supported distracting tab or app.",
  fields: [
    { key: "extremeNudgeTitle", label: "Title", hint: "{closed}" },
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
