import type { EndOfDayReviewEvent, EndOfDayReviewPendingAssessment } from "./endOfDayReviewModel";
import { isBrowserHistoryImportSegment, isFailedForegroundCaptureSegment } from "@drifty/domain";
import type { ActivityCategory, ActivitySegment, AppIconMap, AppIdentity, ProductivityLabel } from "@drifty/domain";
import {
  DAILY_LEADERBOARD_CHECKPOINT_MINUTE,
  type LeaderboardCelebration,
} from "./companionLeaderboardMilestones";

export type EndOfDayReviewSummaryInput = {
  day: string;
  generatedAt: string;
  segments: ActivitySegment[];
  leaderboardCelebration?: LeaderboardCelebration;
  /** `null` explicitly previews the ordinary fully assessed state. */
  assessment?: EndOfDayReviewPendingAssessment | null;
  isMock?: boolean;
};

export const END_OF_DAY_REVIEW_STORAGE_KEY = "drifty.endOfDayReview.lastShownDate";

export const END_OF_DAY_REVIEW_TRIGGER_MINUTE = DAILY_LEADERBOARD_CHECKPOINT_MINUTE;

export const END_OF_DAY_LEADERBOARD_CHECKPOINT_STORAGE_KEY =
  "drifty.endOfDayReview.leaderboardCheckpointDate";

/**
 * A review of a day that barely happened is not a review; it is the app
 * telling the user their day was empty, with a ring, top apps and signals
 * that are all noise. The automatic card waits until the day has enough
 * tracked time to say anything honest about, then fires at the moment the
 * day crosses the bar (from the evening trigger minute until midnight).
 * Days that never cross it are skipped silently — the
 * dashboard remains the place to look at them.
 */
export const END_OF_DAY_REVIEW_MIN_TRACKED_SECONDS = 3 * 60 * 60;

/**
 * When a presentation went out but no display was ever confirmed (the
 * machine slept through it), wait before building another one so a sleeping
 * machine does not churn a fresh event every minute.
 */
export const END_OF_DAY_REVIEW_REPRESENT_COOLDOWN_MS = 15 * 60 * 1000;

export function sumEndOfDayReviewTrackedSeconds(segments: readonly ActivitySegment[]): number {
  // Imported history reconstructs the dashboard, but it was not observed by
  // Drifty after installation and cannot make a thin install day review-ready.
  return segments.reduce(
    (total, segment) => total + (
      isBrowserHistoryImportSegment(segment) || isFailedForegroundCaptureSegment(segment) || !Number.isFinite(segment.durationSeconds)
        ? 0
        : Math.max(0, segment.durationSeconds)
    ),
    0,
  );
}

export function collectMissingEndOfDayReviewIconRequests(event: EndOfDayReviewEvent): AppIdentity[] {
  return (event.sourceSummaries ?? []).flatMap((source) => {
    if (source.iconSrc) return [];
    return [{ appName: source.appName, bundleId: source.bundleId ?? null }];
  });
}

export function mergeResolvedAppIcons(currentIcons: AppIconMap, identities: AppIdentity[], resolvedIcons: AppIconMap): AppIconMap {
  const nextIcons = { ...currentIcons };

  for (const identity of identities) {
    const identityKey = identity.bundleId || identity.appName;
    const iconSrc = resolvedIcons[identityKey] ?? resolvedIcons[identity.appName] ?? null;
    if (!iconSrc) continue;

    nextIcons[identityKey] = iconSrc;
    nextIcons[identity.appName] = iconSrc;
  }

  return nextIcons;
}

export function buildMockEndOfDayReviewSegments(day: string): ActivitySegment[] {
  const previewSegment = ({
    id,
    startHour,
    startMinute = 0,
    durationMinutes,
    appName,
    bundleId,
    windowTitle,
    category,
    productivity,
    browserName,
    siteDomain,
    siteTitle,
    siteUrl,
  }: {
    id: string;
    startHour: number;
    startMinute?: number;
    durationMinutes: number;
    appName: string;
    bundleId: string;
    windowTitle: string;
    category: ActivityCategory;
    productivity: ProductivityLabel;
    browserName?: string;
    siteDomain?: string;
    siteTitle?: string;
    siteUrl?: string;
  }): ActivitySegment => {
    const startedAt = new Date(`${day}T${String(startHour).padStart(2, "0")}:${String(startMinute).padStart(2, "0")}:00`);
    const endedAt = new Date(startedAt.getTime() + durationMinutes * 60 * 1000);
    return {
      id,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationSeconds: durationMinutes * 60,
      appName,
      bundleId,
      browserName,
      siteDomain,
      siteTitle,
      siteUrl,
      windowTitle,
      platform: "macos",
      source: "nsworkspace",
      classification: {
        category,
        productivity,
        source: "manual",
        confidence: 1,
        reason: "Deterministic end-of-day review preview",
      },
    };
  };

  return [
    previewSegment({
      id: "end-of-day-review-preview-vscode-focus",
      startHour: 9,
      durationMinutes: 138,
      appName: "VS Code",
      bundleId: "com.microsoft.VSCode",
      windowTitle: "companion/DriftAlarm.tsx",
      category: "workspace",
      productivity: "focus",
    }),
    previewSegment({
      id: "end-of-day-review-preview-code-focus",
      startHour: 11,
      startMinute: 30,
      durationMinutes: 28,
      appName: "Code",
      bundleId: "com.microsoft.VSCode",
      windowTitle: "EndOfDayReview.tsx",
      category: "workspace",
      productivity: "focus",
    }),
    previewSegment({
      id: "end-of-day-review-preview-figma-focus",
      startHour: 13,
      startMinute: 15,
      durationMinutes: 42,
      appName: "Figma",
      bundleId: "com.figma.Desktop",
      windowTitle: "Notification specs - frame 12",
      category: "workspace",
      productivity: "focus",
    }),
    previewSegment({
      id: "end-of-day-review-preview-youtube-drift",
      startHour: 14,
      startMinute: 20,
      durationMinutes: 38,
      appName: "YouTube",
      bundleId: "com.google.Chrome",
      browserName: "Google Chrome",
      siteDomain: "youtube.com",
      siteTitle: "Design rabbit hole",
      siteUrl: "https://youtube.com/watch?v=preview",
      windowTitle: "Design rabbit hole",
      category: "entertainment",
      productivity: "drift",
    }),
    previewSegment({
      id: "end-of-day-review-preview-slack-neutral",
      startHour: 15,
      startMinute: 30,
      durationMinutes: 33,
      appName: "Slack",
      bundleId: "com.tinyspeck.slackmacgap",
      windowTitle: "Product design sync",
      category: "communication",
      productivity: "neutral",
    }),
    previewSegment({
      id: "end-of-day-review-preview-unknown-neutral",
      startHour: 17,
      durationMinutes: 28,
      appName: "Unknown",
      bundleId: "com.drifty.preview.unknown",
      windowTitle: "Unclassified local activity",
      category: "unknown",
      productivity: "neutral",
    }),
    previewSegment({
      id: "end-of-day-review-preview-social-drift",
      startHour: 18,
      startMinute: 20,
      durationMinutes: 20,
      appName: "X",
      bundleId: "com.apple.Safari",
      browserName: "Safari",
      siteDomain: "x.com",
      siteTitle: "Timeline",
      siteUrl: "https://x.com/home",
      windowTitle: "Timeline",
      category: "social_media",
      productivity: "drift",
    }),
  ];
}

/** Review-only fixture: AI drops at 14:20 while raw tracking continues. */
export function buildMockPendingEndOfDayReviewSegments(day: string): ActivitySegment[] {
  const unavailableAt = new Date(`${day}T14:20:00`).getTime();
  return buildMockEndOfDayReviewSegments(day).map((segment) => (
    new Date(segment.startedAt).getTime() >= unavailableAt
      ? { ...segment, classification: undefined }
      : segment
  ));
}
