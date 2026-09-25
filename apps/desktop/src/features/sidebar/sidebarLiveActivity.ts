import type { CurrentActivitySnapshot } from "@drifty/domain";

export type SidebarLiveActivityLabels = {
  readonly appLabel: string;
  readonly siteLabel: string | null;
};

/**
 * The sidebar's "tracking now" line.
 *
 * The live snapshot is its own capture and can land after the day's records.
 * Until the launch refresh's snapshot arrives, the line keeps the placeholder
 * it showed before the first load instead of falling back to the day's
 * most-used app, which would read as the current app for that moment.
 */
export function resolveSidebarLiveActivityLabels(input: {
  readonly running: boolean;
  readonly snapshot: CurrentActivitySnapshot | null;
  readonly awaitingFirstSnapshot: boolean;
  /** What the line shows before anything has loaded ("No activity"). */
  readonly pendingAppLabel: string;
  readonly fallbackAppLabel: string;
}): SidebarLiveActivityLabels {
  if (!input.running) return { appLabel: input.fallbackAppLabel, siteLabel: null };
  if (input.snapshot) {
    return {
      appLabel: input.snapshot.appName || input.fallbackAppLabel,
      siteLabel: input.snapshot.siteDomain || input.snapshot.siteTitle || null,
    };
  }
  if (input.awaitingFirstSnapshot) return { appLabel: input.pendingAppLabel, siteLabel: null };
  return { appLabel: input.fallbackAppLabel, siteLabel: null };
}
