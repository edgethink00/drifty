import {
  classifyActivityDetailed,
  isBrowserHistoryImportSegment,
  isRemoteDeviceSegment,
  SUSTAINED_SOCIAL_DWELL_MINIMUM_SECONDS,
  type ActivityClassificationDetail,
  type ActivitySegment,
  type ClassificationOptions,
} from "@drifty/domain";
import type { DriftAlarmCandidate } from "./driftAlarmData";
import { buildContinuousDriftAlarmEpisode } from "./driftAlarmEpisode";

/** A live, identified video/feed can stay in one tracker row while the user watches. */
export function buildExplicitVideoDwellCandidate(input: {
  readonly segment: ActivitySegment;
  readonly sourceSegmentId: string;
  readonly classification: ActivityClassificationDetail;
  readonly segments: readonly ActivitySegment[];
  readonly classificationOptions: ClassificationOptions;
  readonly minimumDurationSeconds: number;
}): DriftAlarmCandidate | null {
  if (!isUnclassified(input.classification)) return null;

  const eligible = (segment: ActivitySegment): boolean => (
    !isRemoteDeviceSegment(segment)
    && !isBrowserHistoryImportSegment(segment)
    && isExplicitVideoFeed(segment)
    && isUnclassified(classifyActivityDetailed(segment, input.classificationOptions))
  );
  // Social snapshots can carry a new address before its tracker row arrives.
  // Do not relabel a profile/Focus row's elapsed time as time spent in a Reel.
  const recorded = input.segments.find((segment) => segment.id === input.sourceSegmentId);
  if (!recorded || !eligible(recorded) || !eligible(input.segment)) return null;

  const episode = buildContinuousDriftAlarmEpisode({
    currentSegment: input.segment,
    segments: input.segments,
    isEligibleDrift: eligible,
  });
  if (!episode || episode.durationSeconds < Math.max(
    SUSTAINED_SOCIAL_DWELL_MINIMUM_SECONDS,
    input.minimumDurationSeconds,
  )) return null;

  const category = normalizedHost(input.segment.siteDomain ?? "") === "youtube.com"
    ? "entertainment" as const : "social_media" as const;
  // The user fixed this category's productivity in Settings; do not relabel it drift.
  const preferred = input.classificationOptions.categoryProductivity?.[category];
  if (preferred && preferred !== "drift") return null;
  return {
    alertKey: episode.episodeKey,
    episodeKey: episode.episodeKey,
    driftDurationSeconds: episode.durationSeconds,
    category,
    classification: {
      ...input.classification,
      category,
      productivity: "drift",
      source: "sustained-social-dwell",
      confidence: 1,
      reason: `Explicit video/feed dwell: ${Math.round(episode.durationSeconds)}s on ${input.segment.siteDomain}`,
    },
    segment: input.segment,
    sourceSegmentId: input.sourceSegmentId,
  };
}

function isUnclassified(classification: ActivityClassificationDetail): boolean {
  return classification.source === "unknown" && classification.category === "unknown";
}

function isExplicitVideoFeed(segment: ActivitySegment): boolean {
  if (!segment.siteUrl || !segment.siteDomain) return false;
  let url: URL;
  try {
    url = new URL(segment.siteUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = normalizedHost(url.hostname);
  if (host !== normalizedHost(segment.siteDomain)) return false;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  switch (host) {
    case "youtube.com": return /^\/shorts\/[^/]+$/.test(path);
    case "instagram.com": return /^\/reels?(?:\/[^/]+)?$/.test(path);
    case "tiktok.com": return path === "/" || path === "/foryou" || /^\/@[^/]+\/video\/[^/]+$/.test(path);
    default: return false;
  }
}

function normalizedHost(host: string): string {
  return host.trim().toLowerCase().replace(/^(www|m)\./, "");
}
