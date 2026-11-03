import { isYouTubeSite } from "@drifty/domain";
import type { ActivitySegment, CurrentActivitySnapshot } from "@drifty/domain";
import type { DriftAlarmCorrectionStatus, DriftAlarmFocusTarget } from "./driftAlarmEvent";
import type { ExtremeNudgeTarget } from "./driftAlarmBridge";
import { buildDefaultDriftAlarmCopy, buildExtremeNudgeToastCopy, type DriftAlarmCopySettingsValue, type ExtremeNudgeToastCopyContext } from "./driftAlarmCopy";

export type ExtremeNudgeToastEvent = {
  kind: "extremeNudgeToast";
  placement: "top-right";
  id: string;
  generatedAt: string;
  title: string;
  closedLabel: string;
  focusLabel: string | null;
  breakOptions?: readonly number[];
  /** Button wording from the user's alert copy; the card falls back to defaults when absent. */
  breakLabel?: string;
  correctionLabel?: string;
  correctionStatus?: DriftAlarmCorrectionStatus;
};

export const EXTREME_NUDGE_STORAGE_KEY = "drifty.notifications.extremeNudge";

export type ExtremeNudgeTargetOptions = {
  readonly forceChromiumAxTabClose?: boolean;
  readonly confirmedCurrentSnapshot?: CurrentActivitySnapshot | null;
};

export function buildExtremeNudgeTarget(segment: ActivitySegment, options: ExtremeNudgeTargetOptions = {}): ExtremeNudgeTarget {
  return {
    appName: segment.appName.trim() || "Unknown app",
    bundleId: segment.bundleId?.trim() || null,
    browserName: segment.browserName?.trim() || null,
    siteDomain: segment.siteDomain?.trim() || null,
    siteUrl: currentYouTubeTargetUrl(segment, options.confirmedCurrentSnapshot),
    forceChromiumAxTabClose: options.forceChromiumAxTabClose ?? false,
  };
}

// Classification intentionally keeps the captured YouTube URL (including
// playlist evidence). Refresh only the native action address, after the caller
// has confirmed the candidate, and only for the same app and video.
function currentYouTubeTargetUrl(segment: ActivitySegment, current?: CurrentActivitySnapshot | null): string | null {
  const capturedUrl = segment.siteUrl?.trim() || null;
  const videoId = segment.youtubeVideoId?.trim();
  if (!current || !capturedUrl || !current.siteUrl || !videoId || videoId !== current.youtubeVideoId?.trim()
    || current.appName !== segment.appName || current.bundleId !== segment.bundleId
    || current.browserName !== segment.browserName || current.siteDomain !== segment.siteDomain) return capturedUrl;
  try {
    const before = new URL(capturedUrl);
    const after = new URL(current.siteUrl);
    if (isYouTubeSite(after.hostname) && before.origin === after.origin && before.pathname === after.pathname
      && ["v", "list", "start_radio"].every(key => before.searchParams.get(key) === after.searchParams.get(key))) {
      return current.siteUrl.trim();
    }
  } catch {
    // An unparseable address cannot prove that only query/hash changed.
  }
  return capturedUrl;
}

export function buildExtremeNudgeToastEvent(
  segment: ActivitySegment,
  focusTarget: DriftAlarmFocusTarget | null,
  copySettings: DriftAlarmCopySettingsValue = buildDefaultDriftAlarmCopy(),
  breakOptions: readonly number[] = [],
  closedByPet: ExtremeNudgeToastCopyContext["closedByPet"] = null,
): ExtremeNudgeToastEvent {
  const closedLabel = segment.siteDomain?.trim()
    || segment.siteTitle?.trim()
    || segment.appName.trim()
    || "drift";
  const copy = buildExtremeNudgeToastCopy(copySettings, { closedLabel, closedByPet });

  return {
    kind: "extremeNudgeToast",
    placement: "top-right",
    id: `extreme-nudge:${segment.id}:${Date.now()}`,
    generatedAt: new Date().toISOString(),
    title: copy.title,
    closedLabel,
    focusLabel: focusTarget?.label ?? null,
    breakOptions,
    breakLabel: copySettings.takeBreakLabel,
    correctionLabel: copySettings.manualCorrectionLabel,
  };
}
