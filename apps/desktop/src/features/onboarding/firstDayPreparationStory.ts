import {
  classifyActivityDetailed,
  isExcludedSegment,
  isFailedForegroundCaptureSegment,
  type ActivitySegment,
  type ClassificationOptions,
  type ProductivityLabel,
} from "@drifty/domain";

/** Local facts for the preparation animation and its completed focus highlight. */

/** A segment's productivity, or "pending" while it has no classification yet. */
export type FirstDayVerdict = ProductivityLabel | "pending";

export type FirstDaySource = {
  readonly key: string;
  readonly label: string;
  readonly kind: "app" | "site";
  readonly bundleId: string | null;
  readonly siteDomain: string | null;
};

export type FirstDayDiscoveryItem = FirstDaySource & {
  readonly seconds: number;
  readonly verdict: FirstDayVerdict;
};

export type FirstDayDiscoveries = {
  /** The largest sources first, at most the requested limit. */
  readonly items: readonly FirstDayDiscoveryItem[];
  readonly appCount: number;
  readonly siteCount: number;
  readonly totalSeconds: number;
  readonly classifiedSeconds: number;
  readonly focusSeconds: number;
  readonly driftSeconds: number;
  readonly neutralSeconds: number;
};

function isDriftyItself(segment: ActivitySegment): boolean {
  return Boolean(segment.bundleId?.startsWith("so.drifty.")) || segment.appName.trim().toLowerCase() === "drifty";
}

function isCountable(segment: ActivitySegment): boolean {
  return Number.isFinite(segment.durationSeconds)
    && segment.durationSeconds > 0
    && !isExcludedSegment(segment)
    && !isFailedForegroundCaptureSegment(segment)
    && !isDriftyItself(segment);
}

export function firstDaySourceOf(segment: ActivitySegment): FirstDaySource {
  const domain = segment.siteDomain?.trim().toLowerCase();
  if (domain) {
    return { key: "site:" + domain, label: domain.replace(/^www\./u, ""), kind: "site", bundleId: null, siteDomain: domain };
  }
  const name = segment.appName.trim();
  return { key: "app:" + (segment.bundleId ?? name), label: name, kind: "app", bundleId: segment.bundleId ?? null, siteDomain: null };
}

function verdictOf(segment: ActivitySegment, options?: ClassificationOptions): FirstDayVerdict {
  const classification = classifyActivityDetailed(segment, options);
  return classification.category === "unknown" ? "pending" : classification.productivity;
}

type VerdictSeconds = Record<FirstDayVerdict, number>;
const emptyVerdictSeconds = (): VerdictSeconds => ({ focus: 0, neutral: 0, drift: 0, pending: 0 });

/** The verdict holding the most classified time; pending only while nothing in the source is classified. */
function dominantVerdict(seconds: VerdictSeconds): FirstDayVerdict {
  const classified: ProductivityLabel[] = ["focus", "drift", "neutral"];
  let best: ProductivityLabel | null = null;
  for (const label of classified) {
    if (seconds[label] > 0 && (best === null || seconds[label] > seconds[best])) best = label;
  }
  return best ?? "pending";
}

export function buildFirstDayDiscoveries(
  segments: readonly ActivitySegment[],
  options?: ClassificationOptions,
  limit = 10,
): FirstDayDiscoveries {
  const groups = new Map<string, { source: FirstDaySource; seconds: number; verdicts: VerdictSeconds }>();
  const totals = emptyVerdictSeconds();
  for (const segment of segments) {
    if (!isCountable(segment)) continue;
    const source = firstDaySourceOf(segment);
    const verdict = verdictOf(segment, options);
    const group = groups.get(source.key) ?? { source, seconds: 0, verdicts: emptyVerdictSeconds() };
    group.seconds += segment.durationSeconds;
    group.verdicts[verdict] += segment.durationSeconds;
    groups.set(source.key, group);
    totals[verdict] += segment.durationSeconds;
  }
  const ranked = Array.from(groups.values()).sort((left, right) => right.seconds - left.seconds || left.source.label.localeCompare(right.source.label));
  return {
    items: ranked.slice(0, Math.max(0, limit)).map(({ source, seconds, verdicts }) => ({ ...source, seconds, verdict: dominantVerdict(verdicts) })),
    appCount: ranked.filter((group) => group.source.kind === "app").length,
    siteCount: ranked.filter((group) => group.source.kind === "site").length,
    totalSeconds: totals.focus + totals.neutral + totals.drift + totals.pending,
    classifiedSeconds: totals.focus + totals.neutral + totals.drift,
    focusSeconds: totals.focus,
    driftSeconds: totals.drift,
    neutralSeconds: totals.neutral,
  };
}

/** One drawn block: hour column (0 = the chart's first hour), minute range inside it, and its verdict. */
export type FirstDayRecapBlock = readonly [hourIndex: number, fromMinute: number, toMinute: number, verdict: FirstDayVerdict, sourceKey?: string];
export type FirstDayRecapMoment = { readonly hourIndex: number; readonly minute: number };


const FOCUS_RUN_MAX_GAP_MS = 5 * 60 * 1000;
const MIN_CHART_HOURS = 8;
const HOUR_MS = 60 * 60 * 1000;

type TimedSegment = { readonly segment: ActivitySegment; readonly startMs: number; readonly endMs: number; readonly verdict: FirstDayVerdict };

/** The day as the Today canvas draws it: one column per local clock hour, blocks by minute. */
export type FirstDayChart = {
  /** Clock hour (0-23) of the chart's first column. */
  readonly firstHour: number;
  readonly hourCount: number;
  readonly blocks: readonly FirstDayRecapBlock[];
  /** The longest focus stretch on the chart (focus joined across gaps of up to five minutes). */
  readonly longestFocus: {
    readonly seconds: number;
    readonly startedAt: string;
    readonly source: FirstDaySource;
    readonly from: FirstDayRecapMoment;
    readonly to: FirstDayRecapMoment;
  } | null;
};

function toTimed(segments: readonly ActivitySegment[], options: ClassificationOptions | undefined, bounds?: { readonly startMs: number; readonly endMs: number }): TimedSegment[] {
  const timed: TimedSegment[] = [];
  for (const segment of segments) {
    if (!isCountable(segment)) continue;
    const rawStart = Date.parse(segment.startedAt);
    const rawEnd = Date.parse(segment.endedAt);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) continue;
    const startMs = bounds ? Math.max(rawStart, bounds.startMs) : rawStart;
    const endMs = bounds ? Math.min(Math.max(rawEnd, rawStart), bounds.endMs) : Math.max(rawEnd, rawStart);
    if (endMs <= startMs) continue;
    timed.push({ segment, startMs, endMs, verdict: verdictOf(segment, options) });
  }
  return timed.sort((left, right) => left.startMs - right.startMs);
}

function chartOf(timed: readonly TimedSegment[]): FirstDayChart | null {
  if (timed.length === 0) return null;
  // Columns follow local clock hours, starting at the first hour with activity.
  const firstStart = new Date(timed[0].startMs);
  firstStart.setMinutes(0, 0, 0);
  const baseMs = firstStart.getTime();
  const lastEndMs = Math.max(...timed.map((entry) => entry.endMs));
  const hourCount = Math.max(MIN_CHART_HOURS, Math.ceil((lastEndMs - baseMs) / HOUR_MS));
  const momentAt = (ms: number): FirstDayRecapMoment => {
    const offset = Math.max(0, ms - baseMs);
    const hourIndex = Math.min(hourCount - 1, Math.floor(offset / HOUR_MS));
    return { hourIndex, minute: Math.min(60, (offset - hourIndex * HOUR_MS) / 60_000) };
  };

  const blocks: FirstDayRecapBlock[] = [];
  for (const entry of timed) {
    let cursor = entry.startMs;
    while (cursor < entry.endMs) {
      const hourIndex = Math.floor((cursor - baseMs) / HOUR_MS);
      const hourEnd = baseMs + (hourIndex + 1) * HOUR_MS;
      const until = Math.min(entry.endMs, hourEnd);
      const fromMinute = (cursor - baseMs - hourIndex * HOUR_MS) / 60_000;
      const toMinute = (until - baseMs - hourIndex * HOUR_MS) / 60_000;
      if (toMinute - fromMinute >= 0.5) blocks.push([hourIndex, fromMinute, toMinute, entry.verdict, firstDaySourceOf(entry.segment).key]);
      cursor = until;
    }
  }

  type Run = { seconds: number; startMs: number; endMs: number; sources: Map<string, { source: FirstDaySource; seconds: number }> };
  const runs: Run[] = [];
  let run: Run | null = null;
  for (const entry of timed) {
    if (entry.verdict !== "focus") continue;
    if (!run || entry.startMs > run.endMs + FOCUS_RUN_MAX_GAP_MS) {
      run = { seconds: 0, startMs: entry.startMs, endMs: entry.endMs, sources: new Map() };
      runs.push(run);
    }
    const seconds = (entry.endMs - entry.startMs) / 1000;
    run.seconds += seconds;
    run.endMs = Math.max(run.endMs, entry.endMs);
    const source = firstDaySourceOf(entry.segment);
    const tally = run.sources.get(source.key) ?? { source, seconds: 0 };
    tally.seconds += seconds;
    run.sources.set(source.key, tally);
  }
  const longest = runs.reduce<Run | null>((best, candidate) => (best === null || candidate.seconds > best.seconds ? candidate : best), null);
  const longestSource = longest
    ? Array.from(longest.sources.values()).sort((left, right) => right.seconds - left.seconds)[0]?.source ?? null
    : null;
  return {
    firstHour: firstStart.getHours(),
    hourCount,
    blocks,
    longestFocus: longest && longestSource ? {
      seconds: Math.round(longest.seconds),
      startedAt: new Date(longest.startMs).toISOString(),
      source: longestSource,
      from: momentAt(longest.startMs),
      to: momentAt(longest.endMs),
    } : null,
  };
}

/** The chart of whatever the preparation has loaded so far, for the day being drawn on its screen. */
export function buildFirstDayChart(segments: readonly ActivitySegment[], options?: ClassificationOptions): FirstDayChart | null {
  return chartOf(toTimed(segments, options));
}
