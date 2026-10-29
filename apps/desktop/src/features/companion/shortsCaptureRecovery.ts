import type { ActivitySegment, CurrentActivitySnapshot } from "@drifty/domain";
import { activitySegmentIdentity, currentSnapshotIdentity, getLatestWatcherSegment } from "./watcherData";
import { DRIFT_ALARM_EPISODE_MAX_GAP_SECONDS } from "./driftAlarmEpisode";

type CaptureContext = {
  readonly segments: readonly ActivitySegment[];
  readonly snapshot: CurrentActivitySnapshot | null;
};

export function isExplicitYouTubeShort(activity: Pick<CurrentActivitySnapshot, "siteDomain" | "siteUrl">): boolean {
  return explicitShortId(activity.siteDomain, activity.siteUrl) !== null;
}

// The tracker samples every five seconds. Give a missing native page or its
// next row one bounded chance; never manufacture context or copy a verdict.
const RECOVERY_BUDGET_MS = 6_000;
const RECHECK_DELAY_MS = 1_000;

export async function recoverShortsCapture(input: {
  readonly context: CaptureContext;
  readonly refresh: () => Promise<CaptureContext | null>;
  readonly isCurrent: () => boolean;
}): Promise<CaptureContext> {
  let context = input.context;
  // Wall-clock corrections must not extend this elapsed-time retry window.
  // In-flight IPC keeps its own deadline; this budget bounds new observations.
  const deadline = performance.now() + RECOVERY_BUDGET_MS;
  while (input.isCurrent() && hasPendingShortsCapture(context) && performance.now() < deadline) {
    await new Promise<void>(resolve => setTimeout(resolve, RECHECK_DELAY_MS));
    if (!input.isCurrent() || performance.now() > deadline) break;
    const refreshed = await input.refresh();
    if (!refreshed || !input.isCurrent()) break;
    context = refreshed;
  }
  return context;
}

export function hasPendingShortsCapture({ segments, snapshot }: CaptureContext): boolean {
  if (!snapshot || snapshot.systemTransientActivity) return false;
  const latest = getLatestWatcherSegment([...segments]);
  if (!latest) return false;
  const recordedId = explicitShortId(latest.siteDomain, latest.siteUrl);
  if (!recordedId) return false;
  // A bounded native Mac capture can return only Chrome's app identity when
  // optional page inspection expires. That is not evidence of another page:
  // retry the real observation, without attaching the recorded URL/verdict.
  const nativePageUnavailable = latest.platform === "macos"
    && latest.bundleId === "com.google.Chrome" && snapshot.bundleId === latest.bundleId
    && latest.appName === "Google Chrome" && snapshot.appName === latest.appName
    && latest.browserName === "Google Chrome" && snapshot.browserName === latest.browserName
    && snapshot.source === "nsworkspace" && snapshot.frontmostCaptureSource === "nsworkspace"
    && snapshot.browserAutomationStatus === "unavailable"
    && snapshot.windowTitle == null && snapshot.siteDomain == null
    && snapshot.siteUrl == null && snapshot.siteTitle == null;
  if (!nativePageUnavailable) {
    if (activitySegmentIdentity(latest) !== currentSnapshotIdentity(snapshot)) return false;
    const currentId = explicitShortId(snapshot.siteDomain, snapshot.siteUrl);
    if (!currentId || recordedId === currentId) return false;
  }
  // An old timeline or an invalid clock is not a pending five-second capture.
  const gapMs = Date.parse(snapshot.observedAt) - Date.parse(latest.endedAt);
  return Number.isFinite(gapMs) && gapMs >= 0 && gapMs <= DRIFT_ALARM_EPISODE_MAX_GAP_SECONDS * 1_000;
}

function explicitShortId(domain: string | null | undefined, address: string | null | undefined): string | null {
  if (!address || !domain) return null;
  try {
    const url = new URL(address);
    const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
    if (!["https:", "http:"].includes(url.protocol) || host !== "youtube.com"
      || domain.toLowerCase().replace(/^(www|m)\./, "") !== host) return null;
    return /^\/shorts\/([^/]+)\/?$/.exec(url.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}
