/**
 * Shared model for the dev-signals surfaces.
 *
 * Four UI variants are being compared, so the arithmetic lives here once. The
 * rule every variant must respect: attention time and agent time measure the
 * same clock from two angles and are never added together.
 */

export type MinuteSpan = {
  /** Minutes since local midnight. */
  readonly start: number;
  readonly end: number;
};

export type AttentionSegment = MinuteSpan & {
  readonly app: string;
};

export type AgentTurnBlock = MinuteSpan & {
  readonly model: string | null;
};

export type CommitMarker = {
  /** Minutes since local midnight. */
  readonly min: number;
  readonly ins: number;
  readonly del: number;
  readonly files: number;
  readonly sha: string;
};

export type DevSignalsDay = {
  readonly day: string;
  readonly attention: readonly AttentionSegment[];
  readonly agentSpans: readonly MinuteSpan[];
  readonly agentTurns: readonly AgentTurnBlock[];
  readonly commits: readonly CommitMarker[];
};

export const MINUTES_IN_DAY = 24 * 60;

export function mergeSpans(spans: readonly MinuteSpan[]): MinuteSpan[] {
  const valid = spans.filter((span) => span.end > span.start).slice();
  if (valid.length === 0) return [];
  valid.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [{ start: valid[0]!.start, end: valid[0]!.end }];
  for (const span of valid.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ start: span.start, end: span.end });
    }
  }
  return merged;
}

/**
 * Merge spans for display, closing gaps shorter than `gapMinutes`.
 *
 * Capture produces many one-minute segments separated by seconds. Drawn
 * literally at day scale they read as visual noise rather than as a stretch of
 * work, so display closes small gaps. Reported durations still come from
 * `mergeSpans`, which never invents time.
 */
export function mergeForDisplay(spans: readonly MinuteSpan[], gapMinutes = 6): MinuteSpan[] {
  const merged = mergeSpans(spans);
  if (merged.length === 0) return [];
  const smoothed: { start: number; end: number }[] = [{ ...merged[0]! }];
  for (const span of merged.slice(1)) {
    const last = smoothed[smoothed.length - 1]!;
    if (span.start - last.end <= gapMinutes) {
      last.end = Math.max(last.end, span.end);
    } else {
      smoothed.push({ ...span });
    }
  }
  return smoothed;
}

function totalMinutes(spans: readonly MinuteSpan[]): number {
  return spans.reduce((sum, span) => sum + (span.end - span.start), 0);
}

export function overlapMinutes(a: readonly MinuteSpan[], b: readonly MinuteSpan[]): number {
  let total = 0;
  for (const left of a) {
    for (const right of b) {
      total += Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));
    }
  }
  return total;
}

export type DevSignalsSummary = {
  readonly attentionMinutes: number;
  readonly agentMinutes: number;
  /** Agent time that ran while nothing was captured in front of the user. */
  readonly unattendedMinutes: number;
  /** Agent time the user was also present for. */
  readonly attendedMinutes: number;
  /** Real time covered by either signal. Never the sum of the two. */
  readonly combinedMinutes: number;
  readonly commitCount: number;
  readonly insertions: number;
  readonly deletions: number;
  /** Highest number of agent turns running at one instant. */
  readonly concurrencyPeak: number;
  /** Cumulative agent minutes over wall-clock agent minutes. */
  readonly parallelFactor: number;
};

export function peakConcurrency(turns: readonly MinuteSpan[]): number {
  const edges: { at: number; delta: number }[] = [];
  for (const turn of turns) {
    if (turn.end <= turn.start) continue;
    edges.push({ at: turn.start, delta: 1 });
    edges.push({ at: turn.end, delta: -1 });
  }
  // An end sorts before a start at the same minute, so a turn finishing as
  // another begins is not counted as overlap.
  edges.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let current = 0;
  let peak = 0;
  for (const edge of edges) {
    current += edge.delta;
    peak = Math.max(peak, current);
  }
  return peak;
}

export function summarize(day: DevSignalsDay): DevSignalsSummary {
  const attention = mergeSpans(day.attention);
  const agent = mergeSpans(day.agentSpans);
  const attentionMinutes = totalMinutes(attention);
  const agentMinutes = totalMinutes(agent);
  const attendedMinutes = overlapMinutes(agent, attention);
  const cumulative = day.agentTurns.reduce((sum, turn) => sum + Math.max(0, turn.end - turn.start), 0);
  return {
    attentionMinutes,
    agentMinutes,
    attendedMinutes,
    unattendedMinutes: Math.max(0, agentMinutes - attendedMinutes),
    combinedMinutes: totalMinutes(mergeSpans([...day.attention, ...day.agentSpans])),
    commitCount: day.commits.length,
    insertions: day.commits.reduce((sum, commit) => sum + commit.ins, 0),
    deletions: day.commits.reduce((sum, commit) => sum + commit.del, 0),
    concurrencyPeak: peakConcurrency(day.agentTurns),
    parallelFactor: agentMinutes > 0 ? Number((cumulative / agentMinutes).toFixed(2)) : 0,
  };
}

export function formatHours(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  return `${hours.toFixed(1)}h`;
}

export function formatClock(minute: number): string {
  // Round first: 15:59.6 must become 16:00, not the impossible 15:60.
  const rounded = Math.round(minute);
  const hour = Math.floor(rounded / 60) % 24;
  const rest = rounded % 60;
  return `${String(hour).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** True when the day has no dev signals at all and the surface should hide. */
export function hasDevSignals(day: DevSignalsDay | null | undefined): boolean {
  if (!day) return false;
  return day.commits.length > 0 || day.agentSpans.length > 0;
}
