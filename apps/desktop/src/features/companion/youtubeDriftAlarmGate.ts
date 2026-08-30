import {
  classifyActivityDetailed,
  isYouTubeBrowsePage,
  isYouTubeVideoSegment,
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

const DEFAULT_YOUTUBE_DRIFT_ALARM_GATE_TIMEOUT_MS = 12_000;
export const YOUTUBE_DRIFT_ALARM_GATE_TIMEOUT_MS = DEFAULT_YOUTUBE_DRIFT_ALARM_GATE_TIMEOUT_MS;
export const YOUTUBE_DRIFT_ALARM_GATE_DEADLINE_MS = 60_000;
const AI_DRIFT_ALARM_MINIMUM_CONFIDENCE = 0.85;

export type YouTubeDriftAlarmGateSettledResult =
  | { kind: "allow_drift"; reason: string }
  | { kind: "suppress"; reason: string }
  | { kind: "skipped"; reason: string };

export type YouTubeDriftAlarmGateResult =
  | YouTubeDriftAlarmGateSettledResult
  | { kind: "pending"; reason: "ai-timeout"; settled: Promise<YouTubeDriftAlarmGateSettledResult> };

export type YouTubeDriftAlarmGateInput = {
  readonly segment: ActivitySegment;
  readonly category: ActivityCategory;
  readonly aiOptions?: AiClassificationRunOptions | null;
  readonly timeoutMs?: number;
  readonly deadlineMs?: number;
};

export async function evaluateYouTubeDriftAlarmGate(input: YouTubeDriftAlarmGateInput): Promise<YouTubeDriftAlarmGateResult> {
  const skipReason = youtubeGateSkipReason(input.segment);
  if (skipReason) return { kind: "skipped", reason: skipReason };

  const deterministicClassification = classifyActivityDetailed(input.segment, { includeAiClassifications: false });
  if (deterministicClassification.source !== "youtube" || deterministicClassification.productivity !== "drift") {
    return { kind: "skipped", reason: "not-deterministic-youtube-drift" };
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
      return { kind: "allow_drift", reason: "ai-confirmed-drift" };
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
