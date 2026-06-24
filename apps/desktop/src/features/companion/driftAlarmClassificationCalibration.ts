import type { ActivityClassificationDetail, ActivitySegment, ClassificationOptions } from "@drifty/domain";
import {
  buildAppClassificationHistoryStats,
  classificationKey,
  getAppClassificationHistorySupport,
  share,
  type AppClassificationHistoryStats,
} from "./appClassificationHistoryStats";

const COLD_START_NUDGE_MAX_SEGMENTS = 3;
const COLD_START_CONFIDENCE_CAP = 0.7;
const MIN_APP_HISTORY_SEGMENTS = 6;
const MIN_APP_HISTORY_SECONDS = 30 * 60;
const DOMINANT_OVERRIDE_MIN_SEGMENTS = 12;
const DOMINANT_OVERRIDE_MIN_SECONDS = 3 * 60 * 60;
const RARE_PAIR_SHARE = 0.03;
const RARE_PRODUCTIVITY_SHARE = 0.05;
const UNCOMMON_PAIR_SHARE = 0.1;
const MODERATE_DOMINANT_PAIR_SHARE = 0.7;
const STRONG_DOMINANT_PAIR_SHARE = 0.8;
const OVERWHELMING_DOMINANT_SHARE = 0.95;
const DOMINANT_OVERRIDE_CONFIDENCE = 0.7;
const STRONG_OUTLIER_CONFIDENCE_CAP = 0.72;
const PRODUCTIVITY_OUTLIER_CONFIDENCE_CAP = 0.78;
const MILD_OUTLIER_CONFIDENCE_CAP = 0.88;

export type AppClassificationHistoryCalibrationAction =
  | "none"
  | "cold_start_downranked"
  | "confidence_downranked"
  | "overrode_to_dominant_history";

export type AppClassificationHistoryCalibrationResult = {
  readonly classification: ActivityClassificationDetail;
  readonly action: AppClassificationHistoryCalibrationAction;
};

export function calibrateAppLlmClassificationWithHistory({
  segment,
  classification,
  historySegments,
  classificationOptions,
  excludeSegmentIds,
}: {
  readonly segment: ActivitySegment;
  readonly classification: ActivityClassificationDetail;
  readonly historySegments: readonly ActivitySegment[];
  readonly classificationOptions: ClassificationOptions;
  readonly excludeSegmentIds?: ReadonlySet<string>;
}): AppClassificationHistoryCalibrationResult {
  if (classification.source !== "llm" || classification.surface !== "app") return unchanged(classification);

  const support = getAppClassificationHistorySupport({ currentSegment: segment, historySegments, excludeSegmentIds });
  if (classification.productivity === "drift" && support.segmentCount <= COLD_START_NUDGE_MAX_SEGMENTS) {
    return {
      classification: {
        ...classification,
        confidence: Math.min(classification.confidence, COLD_START_CONFIDENCE_CAP),
        reason: withCalibrationReason(
          classification.reason,
          `suppressed app LLM drift cold start with ${support.segmentCount} prior segments`,
        ),
      },
      action: "cold_start_downranked",
    };
  }

  const stats = buildAppClassificationHistoryStats({
    currentSegment: segment,
    historySegments,
    classificationOptions,
    excludeSegmentIds,
  });
  if (!stats || !hasMinimumHistorySupport(stats)) return unchanged(classification);

  const dominantPairShare = share(stats.dominantPair.weightedSeconds, stats.totalWeightedSeconds);
  const currentPairShare = share(
    stats.pairBuckets.get(classificationKey(classification.category, classification.productivity))?.weightedSeconds ?? 0,
    stats.totalWeightedSeconds,
  );

  if (shouldOverrideToDominantPair(stats, currentPairShare, dominantPairShare)) {
    return {
      classification: {
        ...classification,
        category: stats.dominantPair.category,
        productivity: stats.dominantPair.productivity,
        confidence: DOMINANT_OVERRIDE_CONFIDENCE,
        reason: withCalibrationReason(
          classification.reason,
          `overrode to dominant app history ${stats.dominantPair.category}/${stats.dominantPair.productivity} at ${formatShare(dominantPairShare)}`,
        ),
      },
      action: "overrode_to_dominant_history",
    };
  }

  const confidenceCap = confidenceCapForHistoryOutlier({
    classification,
    stats,
    currentPairShare,
    dominantPairShare,
  });
  if (!confidenceCap || classification.confidence <= confidenceCap.maxConfidence) return unchanged(classification);

  return {
    classification: {
      ...classification,
      confidence: confidenceCap.maxConfidence,
      reason: withCalibrationReason(classification.reason, confidenceCap.reason),
    },
    action: "confidence_downranked",
  };
}

type ConfidenceCap = {
  readonly maxConfidence: number;
  readonly reason: string;
};

function confidenceCapForHistoryOutlier({
  classification,
  stats,
  currentPairShare,
  dominantPairShare,
}: {
  readonly classification: ActivityClassificationDetail;
  readonly stats: AppClassificationHistoryStats;
  readonly currentPairShare: number;
  readonly dominantPairShare: number;
}): ConfidenceCap | null {
  if (currentPairShare < RARE_PAIR_SHARE && dominantPairShare >= STRONG_DOMINANT_PAIR_SHARE) {
    return {
      maxConfidence: STRONG_OUTLIER_CONFIDENCE_CAP,
      reason: `downranked rare app category/productivity from ${formatShare(currentPairShare)} against dominant ${formatShare(dominantPairShare)}`,
    };
  }

  const currentProductivityShare = share(
    stats.productivityBuckets.get(classification.productivity)?.weightedSeconds ?? 0,
    stats.totalWeightedSeconds,
  );
  const dominantProductivityShare = share(stats.dominantProductivity.weightedSeconds, stats.totalWeightedSeconds);
  if (
    classification.productivity !== stats.dominantProductivity.productivity
    && currentProductivityShare < RARE_PRODUCTIVITY_SHARE
    && dominantProductivityShare >= STRONG_DOMINANT_PAIR_SHARE
  ) {
    return {
      maxConfidence: PRODUCTIVITY_OUTLIER_CONFIDENCE_CAP,
      reason: `downranked rare app productivity from ${formatShare(currentProductivityShare)} against dominant ${formatShare(dominantProductivityShare)}`,
    };
  }

  if (currentPairShare < UNCOMMON_PAIR_SHARE && dominantPairShare >= MODERATE_DOMINANT_PAIR_SHARE) {
    return {
      maxConfidence: MILD_OUTLIER_CONFIDENCE_CAP,
      reason: `downranked uncommon app category/productivity from ${formatShare(currentPairShare)} against dominant ${formatShare(dominantPairShare)}`,
    };
  }

  return null;
}

function shouldOverrideToDominantPair(
  stats: AppClassificationHistoryStats,
  currentPairShare: number,
  dominantPairShare: number,
): boolean {
  return stats.segmentCount >= DOMINANT_OVERRIDE_MIN_SEGMENTS
    && stats.totalSeconds >= DOMINANT_OVERRIDE_MIN_SECONDS
    && currentPairShare < RARE_PAIR_SHARE
    && dominantPairShare >= OVERWHELMING_DOMINANT_SHARE;
}

function hasMinimumHistorySupport(stats: AppClassificationHistoryStats): boolean {
  return stats.segmentCount >= MIN_APP_HISTORY_SEGMENTS
    && stats.totalSeconds >= MIN_APP_HISTORY_SECONDS
    && stats.totalWeightedSeconds > 0;
}

function formatShare(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function withCalibrationReason(existingReason: string, calibrationReason: string): string {
  return `${existingReason}; app history calibration ${calibrationReason}`;
}

function unchanged(classification: ActivityClassificationDetail): AppClassificationHistoryCalibrationResult {
  return { classification, action: "none" };
}
