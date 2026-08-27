import {
  estimateCommunityFocusPercentile,
  isCommunityFocusPercentileModelFresh,
  type CommunityFocusPercentileModel,
} from "./communityFocusPercentile";
import type { CompanionPillMilestoneEvent } from "./CompanionPillMoment";

export const COMPANION_COMMUNITY_MILESTONES_STORAGE_KEY =
  "drifty.companion.communityMilestones.v1";
export const COMPANION_COMMUNITY_TOP_PERCENT_THRESHOLD = 10;

/** Device-local progress: the first successful Top 10% day is celebrated once. */
export type CompanionCommunityMilestoneProgress = {
  readonly celebratedDailyTopTen: boolean;
  readonly suppressedDay: string | null;
};

const EMPTY_PROGRESS: CompanionCommunityMilestoneProgress = {
  celebratedDailyTopTen: false,
  suppressedDay: null,
};

export function evaluateCompanionCommunityMilestone({
  progress,
  day,
  focusSeconds,
  model,
  announce,
}: {
  readonly progress: CompanionCommunityMilestoneProgress;
  readonly day: string;
  readonly focusSeconds: number;
  readonly model: CommunityFocusPercentileModel | null;
  readonly announce: boolean;
}): {
  readonly progress: CompanionCommunityMilestoneProgress;
  readonly event: CompanionPillMilestoneEvent | null;
} {
  if (progress.celebratedDailyTopTen
    || progress.suppressedDay === day
    || !isCommunityFocusPercentileModelFresh(model)
    || model.period !== "daily") {
    return { progress, event: null };
  }
  const estimate = estimateCommunityFocusPercentile(focusSeconds, model);
  if (!estimate
    || focusSeconds <= 0
    || estimate.topPercent > COMPANION_COMMUNITY_TOP_PERCENT_THRESHOLD) {
    return { progress, event: null };
  }
  if (!announce) {
    // Do not replay a stale achievement later when quiet-period or native
    // availability changes; a future day can still earn the lifetime-first event.
    return { progress: { ...progress, suppressedDay: day }, event: null };
  }

  return {
    progress,
    event: {
      kind: "milestone",
      id: `companion-community-estimate:${day}:daily-top10`,
      milestoneKind: "rank",
      tier: 2,
      title: "Top 10% focus today",
      subtitle: `Estimated from ${estimate.sampleSize} leaderboard participants`,
      destination: "dashboard",
      statSeconds: Math.max(0, Math.floor(focusSeconds)),
      statLabel: "today",
      generatedAt: new Date().toISOString(),
    },
  };
}

export function completeCompanionCommunityMilestoneDelivery(
  progress: CompanionCommunityMilestoneProgress,
  day: string,
  delivered: boolean,
): CompanionCommunityMilestoneProgress {
  // A failed launch suppresses only this community event for the day. The
  // shared delivery slot is released separately so another achievement may use it.
  return delivered
    ? { celebratedDailyTopTen: true, suppressedDay: null }
    : { ...progress, suppressedDay: day };
}

export function readCompanionCommunityMilestones(): CompanionCommunityMilestoneProgress {
  if (typeof window === "undefined") return EMPTY_PROGRESS;
  try {
    const raw = window.localStorage.getItem(COMPANION_COMMUNITY_MILESTONES_STORAGE_KEY);
    if (!raw) return EMPTY_PROGRESS;
    const parsed: unknown = JSON.parse(raw);
    return isProgress(parsed) ? parsed : EMPTY_PROGRESS;
  } catch {
    return EMPTY_PROGRESS;
  }
}

export function persistCompanionCommunityMilestones(progress: CompanionCommunityMilestoneProgress): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COMPANION_COMMUNITY_MILESTONES_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // The hook's in-memory progress still prevents repeats for this session.
  }
}

function isProgress(value: unknown): value is CompanionCommunityMilestoneProgress {
  if (typeof value !== "object" || value === null) return false;
  const progress = value as Partial<CompanionCommunityMilestoneProgress>;
  return typeof progress.celebratedDailyTopTen === "boolean"
    && (progress.suppressedDay === null
      || (typeof progress.suppressedDay === "string"
        && /^\d{4}-\d{2}-\d{2}$/.test(progress.suppressedDay)));
}
