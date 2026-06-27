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
} from "../classification/aiClassificationService";

const DEFAULT_YOUTUBE_DRIFT_ALARM_GATE_TIMEOUT_MS = 12_000;
const AI_DRIFT_ALARM_MINIMUM_CONFIDENCE = 0.85;

export type YouTubeDriftAlarmGateResult =
  | { kind: "allow_drift"; reason: string }
  | { kind: "suppress"; reason: string }
  | { kind: "skipped"; reason: string };

export type YouTubeDriftAlarmGateInput = {
  readonly segment: ActivitySegment;
  readonly category: ActivityCategory;
  readonly aiOptions?: AiClassificationRunOptions | null;
  readonly timeoutMs?: number;
};

class YouTubeDriftAlarmGateTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`YouTube drift alarm AI gate timed out after ${timeoutMs}ms.`);
    this.name = "YouTubeDriftAlarmGateTimeoutError";
  }
}

export async function evaluateYouTubeDriftAlarmGate(input: YouTubeDriftAlarmGateInput): Promise<YouTubeDriftAlarmGateResult> {
  const skipReason = youtubeGateSkipReason(input.segment);
  if (skipReason) return { kind: "skipped", reason: skipReason };

  const deterministicClassification = classifyActivityDetailed(input.segment, { includeAiClassifications: false });
  if (deterministicClassification.source !== "youtube" || deterministicClassification.productivity !== "drift") {
    return { kind: "skipped", reason: "not-deterministic-youtube-drift" };
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_YOUTUBE_DRIFT_ALARM_GATE_TIMEOUT_MS;
  try {
    const aiOptions = {
      ...(input.aiOptions ?? {}),
      persistLiveResult: true,
    } satisfies AiClassificationRunOptions;
    const aiResult = await withTimeout(
      classifyLiveActivityWithAi(input.segment, aiOptions),
      timeoutMs,
    );

    switch (aiResult.kind) {
      case "classified":
        return gateResultForAiClassification(aiResult.classification.productivity, aiResult.classification.confidence);
      case "unavailable":
        return { kind: "suppress", reason: `ai-unavailable:${aiResult.reason}` };
      default:
        return assertNever(aiResult);
    }
  } catch (error) {
    if (error instanceof YouTubeDriftAlarmGateTimeoutError) {
      return { kind: "suppress", reason: "ai-timeout" };
    }
    return { kind: "suppress", reason: error instanceof Error ? error.message : "ai-gate-failed" };
  }
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

function gateResultForAiClassification(productivity: ProductivityLabel, confidence: number): YouTubeDriftAlarmGateResult {
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new YouTubeDriftAlarmGateTimeoutError(timeoutMs));
    }, timeoutMs);

    promise.then(resolve, reject).finally(() => {
      globalThis.clearTimeout(timeoutId);
    });
  });
}

function assertNever(value: never): never {
  throw new Error(`Unexpected YouTube drift alarm gate variant: ${String(value)}`);
}
