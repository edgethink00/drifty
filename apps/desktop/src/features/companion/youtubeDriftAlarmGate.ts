import {
  classifyActivityDetailed,
  isYouTubeBrowsePage,
  isYouTubeVideoSegment,
  isUnresolvedSocialSurface,
  resolveSocialSurface,
} from "@drifty/domain";
import type {
  ActivityCategory,
  ActivitySegment,
  ProductivityLabel,
} from "@drifty/domain";
import {
  classifyLiveActivityWithAi,
  type AiClassificationRunOptions,
  type LiveAiClassificationResult,
} from "../classification/aiClassificationService";
import { selectedYouTubeDriftReason } from "./youtubeDeterministicDrift";

const DEFAULT_YOUTUBE_DRIFT_ALARM_GATE_TIMEOUT_MS = 12_000;
export const YOUTUBE_DRIFT_ALARM_GATE_TIMEOUT_MS = DEFAULT_YOUTUBE_DRIFT_ALARM_GATE_TIMEOUT_MS;
export const YOUTUBE_DRIFT_ALARM_GATE_DEADLINE_MS = 60_000;
const AI_DRIFT_ALARM_MINIMUM_CONFIDENCE = 0.85;

export type YouTubeDriftAlarmGateSettledResult =
  | { kind: "allow_drift"; reason: string; aiConfirmed: boolean }
  | { kind: "suppress"; reason: string }
  // No extra AI veto. This does not classify a segment as drift: callers must
  // select a drift candidate first and revalidate the current surface before
  // delivery (including manual/user rules and stored focus/music exceptions).
  | { kind: "skipped"; reason: string };

export type YouTubeDriftAlarmGateResult =
  | YouTubeDriftAlarmGateSettledResult
  | { kind: "pending"; reason: "ai-timeout"; settled: Promise<YouTubeDriftAlarmGateSettledResult> };

export type YouTubeDriftAlarmGateInput = {
  readonly segment: ActivitySegment;
  readonly category: ActivityCategory;
  readonly allowAiClassification?: boolean;
  readonly aiOptions?: AiClassificationRunOptions | null;
  readonly timeoutMs?: number;
  readonly deadlineMs?: number;
};

export async function evaluateYouTubeDriftAlarmGate(input: YouTubeDriftAlarmGateInput): Promise<YouTubeDriftAlarmGateResult> {
  const subject = resolveDriftAlarmGateSubject(input.segment);
  if (subject.kind === "skip") return { kind: "skipped", reason: subject.reason };
  if (input.allowAiClassification === false) {
    return { kind: "suppress", reason: "ai-unavailable:classification-gate" };
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_YOUTUBE_DRIFT_ALARM_GATE_TIMEOUT_MS;
  const deadlineMs = Math.max(timeoutMs, input.deadlineMs ?? YOUTUBE_DRIFT_ALARM_GATE_DEADLINE_MS);
  const aiOptions = {
    ...(input.aiOptions ?? {}),
    persistLiveResult: true,
  } satisfies AiClassificationRunOptions;
  const settled = classifyLiveActivityWithAi(input.segment, aiOptions).then(
    gateResultFromLiveAi,
    (error: unknown): YouTubeDriftAlarmGateSettledResult => (
      { kind: "suppress", reason: error instanceof Error ? error.message : "ai-gate-failed" }
    ),
  );

  const result = await Promise.race([
    settled.then((value) => ({ kind: "ready" as const, value })),
    delay(timeoutMs).then(() => ({ kind: "timeout" as const })),
  ]);
  if (result.kind === "ready") return result.value;

  return {
    kind: "pending",
    reason: "ai-timeout",
    settled: Promise.race([
      settled,
      delay(deadlineMs - timeoutMs).then((): YouTubeDriftAlarmGateSettledResult => (
        { kind: "suppress", reason: "ai-deadline" }
      )),
    ]),
  };
}

function youtubeGateSkipReason(segment: ActivitySegment): string | null {
  if (isYouTubeShortsSegment(segment)) return "youtube-shorts";
  if (isYouTubeBrowsePage(segment)) return "youtube-browse";
  if (!isYouTubeVideoSegment(segment)) return "not-youtube-video";
  return null;
}

/**
 * Which candidates must clear the AI gate before an intervention fires.
 *
 * YouTube videos were the original case. Social surfaces join them because a
 * host verdict alone cannot separate a doomscroll from a work DM or a profile
 * someone was asked to read — and the intervention on the other side of this
 * gate can close the tab. Social consumption surfaces (reels, explore, a
 * settled home feed) carry their own evidence and skip the gate, the same way
 * a resolved YouTube video does.
 */
type DriftAlarmGateSubject =
  | { readonly kind: "check" }
  | { readonly kind: "skip"; readonly reason: string };

function resolveDriftAlarmGateSubject(segment: ActivitySegment): DriftAlarmGateSubject {
  if (resolveSocialSurface(segment)) {
    return isUnresolvedSocialSurface(segment)
      ? { kind: "check" }
      : { kind: "skip", reason: "social-consumption-surface" };
  }

  const skipReason = youtubeGateSkipReason(segment);
  if (skipReason) return { kind: "skip", reason: skipReason };

  const deterministicClassification = classifyActivityDetailed(segment, { includeAiClassifications: false });
  if (deterministicClassification.source !== "youtube" || deterministicClassification.productivity !== "drift") {
    return { kind: "skip", reason: "not-deterministic-youtube-drift" };
  }
  const selectedReason = selectedYouTubeDriftReason(segment);
  if (selectedReason) return { kind: "skip", reason: selectedReason };
  return { kind: "check" };
}

function isYouTubeShortsSegment(segment: ActivitySegment): boolean {
  if (segment.youtubeIsShorts) return true;
  const siteUrl = segment.siteUrl?.trim();
  if (!siteUrl) return false;

  try {
    return new URL(siteUrl).pathname.startsWith("/shorts/");
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

function gateResultFromLiveAi(aiResult: LiveAiClassificationResult): YouTubeDriftAlarmGateSettledResult {
  switch (aiResult.kind) {
    case "classified":
      return gateResultForAiClassification(aiResult.classification.productivity, aiResult.classification.confidence);
    case "unavailable":
      return { kind: "suppress", reason: `ai-unavailable:${aiResult.reason}` };
    default:
      return assertNever(aiResult);
  }
}

function gateResultForAiClassification(productivity: ProductivityLabel, confidence: number): YouTubeDriftAlarmGateSettledResult {
  switch (productivity) {
    case "drift":
      if (confidence < AI_DRIFT_ALARM_MINIMUM_CONFIDENCE) return { kind: "suppress", reason: "ai-low-confidence" };
      return { kind: "allow_drift", reason: "ai-confirmed-drift", aiConfirmed: true };
    case "focus":
    case "neutral":
      return { kind: "suppress", reason: `ai-classified-${productivity}` };
    default:
      return assertNever(productivity);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function assertNever(value: never): never {
  throw new Error(`Unexpected YouTube drift alarm gate variant: ${String(value)}`);
}
