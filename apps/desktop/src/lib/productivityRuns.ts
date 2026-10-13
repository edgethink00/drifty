import {
  classifyActivityDetailed,
  type ActivitySegment,
  type ClassificationOptions,
} from "@drifty/domain";

/** A gap of at most five minutes keeps a run going, whatever fills it. */
export const PRODUCTIVITY_RUN_MAX_GAP_MS = 5 * 60 * 1000;

export type ProductivityRunPart = {
  readonly startMs: number;
  readonly endMs: number;
  readonly seconds: number;
};

export type ProductivityRun = {
  /** Start of the run's first segment. */
  readonly startMs: number;
  /** Latest end among the run's segments. */
  readonly endMs: number;
  /** Recorded time of the run's own segments; the short gaps are not counted. */
  readonly seconds: number;
};

/**
 * Join same-label parts into runs. This is the Day Review's "Longest streak"
 * rule, shared so every surface using that label reports the same number for
 * the same day.
 */
export function joinProductivityRuns(parts: readonly ProductivityRunPart[]): ProductivityRun[] {
  const ordered = parts
    .filter((part) => Number.isFinite(part.startMs) && Number.isFinite(part.endMs))
    .slice()
    .sort((left, right) => left.startMs - right.startMs);
  const runs: ProductivityRun[] = [];
  let runStartMs = 0;
  let runEndMs = 0;
  let runSeconds = 0;
  for (const part of ordered) {
    const endMs = Math.max(part.startMs, part.endMs);
    if (runSeconds > 0 && part.startMs > runEndMs + PRODUCTIVITY_RUN_MAX_GAP_MS) {
      runs.push({ startMs: runStartMs, endMs: runEndMs, seconds: runSeconds });
      runSeconds = 0;
    }
    if (runSeconds === 0) runStartMs = part.startMs;
    runSeconds += Math.max(0, part.seconds);
    runEndMs = Math.max(runEndMs, endMs);
  }
  if (runSeconds > 0) runs.push({ startMs: runStartMs, endMs: runEndMs, seconds: runSeconds });
  return runs;
}

/** Classified Focus or Drift runs; unclassified time never starts or extends one. */
export function buildProductivityRuns(
  segments: readonly ActivitySegment[],
  productivity: "focus" | "drift",
  classificationOptions?: ClassificationOptions,
): ProductivityRun[] {
  return joinProductivityRuns(segments
    .filter((segment) => {
      const classification = classifyActivityDetailed(segment, classificationOptions);
      return classification.category !== "unknown" && classification.productivity === productivity;
    })
    .map(toProductivityRunPart));
}

export function toProductivityRunPart(segment: ActivitySegment): ProductivityRunPart {
  return {
    startMs: new Date(segment.startedAt).getTime(),
    endMs: new Date(segment.endedAt).getTime(),
    seconds: Math.max(0, segment.durationSeconds),
  };
}

/** The longest run; a tie goes to the earlier run. */
export function longestProductivityRun(runs: readonly ProductivityRun[]): ProductivityRun | null {
  return runs.reduce<ProductivityRun | null>((best, run) => (best === null || run.seconds > best.seconds ? run : best), null);
}
