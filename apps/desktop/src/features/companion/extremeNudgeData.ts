import type { ActivitySegment } from "@drifty/domain";
import type { DriftAlarmFocusTarget } from "./DriftAlarm";
import type { ExtremeNudgeToastEvent } from "./ExtremeNudgeToast";
import type { ExtremeNudgeTarget } from "./driftAlarmBridge";
import { buildDefaultDriftAlarmCopy, buildExtremeNudgeToastCopy, type DriftAlarmCopySettingsValue } from "./driftAlarmCopy";

export const EXTREME_NUDGE_STORAGE_KEY = "drifty.notifications.extremeNudge";

export type ExtremeNudgeTargetOptions = {
  readonly forceChromiumAxTabClose?: boolean;
};

export function buildExtremeNudgeTarget(segment: ActivitySegment, options: ExtremeNudgeTargetOptions = {}): ExtremeNudgeTarget {
  return {
    appName: segment.appName.trim() || "Unknown app",
    bundleId: segment.bundleId?.trim() || null,
    browserName: segment.browserName?.trim() || null,
    siteDomain: segment.siteDomain?.trim() || null,
    siteUrl: segment.siteUrl?.trim() || null,
    forceChromiumAxTabClose: options.forceChromiumAxTabClose ?? false,
  };
}

export function buildExtremeNudgeToastEvent(
  segment: ActivitySegment,
  focusTarget: DriftAlarmFocusTarget | null,
  copySettings: DriftAlarmCopySettingsValue = buildDefaultDriftAlarmCopy(),
): ExtremeNudgeToastEvent {
  const closedLabel = segment.siteDomain?.trim()
    || segment.siteTitle?.trim()
    || segment.appName.trim()
    || "drift";
  const copy = buildExtremeNudgeToastCopy(copySettings, { closedLabel });

  return {
    kind: "extremeNudgeToast",
    placement: "top-right",
    id: `extreme-nudge:${segment.id}:${Date.now()}`,
    generatedAt: new Date().toISOString(),
    title: copy.title,
    closedLabel,
    focusLabel: focusTarget?.label ?? null,
  };
}
