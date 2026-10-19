import {
  classifyActivityDetailed,
  isBrowserHistoryImportSegment,
  isExcludedSegment,
  isFailedForegroundCaptureSegment,
  logicalDayEndExclusiveMs,
  logicalDayStartMs,
  shiftIsoDate,
  type ActivitySegment,
  type ClassificationOptions,
  type ProductivityLabel,
} from "@drifty/domain";
import type { OnboardingIntroDecisionReason } from "../../lib/analytics/eventTaxonomy";

/** Local facts for the post-onboarding tutorial; independent of preparation rendering. */

/** A segment's productivity, or "pending" while it has no classification yet. */
export type FirstDayVerdict = ProductivityLabel | "pending";

export type FirstDaySource = {
  readonly key: string;
  readonly label: string;
  readonly kind: "app" | "site";
  readonly bundleId: string | null;
  readonly siteDomain: string | null;
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

/** One drawn block: hour column (0 = the chart's first hour), minute range inside it, and its verdict. */
export type FirstDayRecapBlock = readonly [hourIndex: number, fromMinute: number, toMinute: number, verdict: FirstDayVerdict, sourceKey?: string];
export type FirstDayRecapMoment = { readonly hourIndex: number; readonly minute: number };

export type FirstDayRecap = {
  readonly day: string;
  /** Every counted segment came from the browser-history import, so the day was rebuilt, not watched. */
  readonly importedOnly: boolean;
  readonly focusSeconds: number;
  readonly driftSeconds: number;
  readonly neutralSeconds: number;
  readonly classifiedSeconds: number;
  readonly longestFocus: {
    readonly seconds: number;
    readonly startedAt: string;
    readonly source: FirstDaySource;
    readonly from: FirstDayRecapMoment;
    readonly to: FirstDayRecapMoment;
  } | null;
  readonly topDrift: { readonly seconds: number; readonly source: FirstDaySource } | null;
  /** The site with the most drift (any amount), so the Automatic close preview can close a real tab even when the top drift was an app. */
  readonly topDriftSite: FirstDaySource | null;
  /** Clock hour (0-23) of the chart's first column. */
  readonly firstHour: number;
  readonly hourCount: number;
  readonly blocks: readonly FirstDayRecapBlock[];
};

/** Below this much classified time the day has nothing honest to say; the intro keeps its sample cards. */
export const FIRST_DAY_RECAP_MIN_CLASSIFIED_SECONDS = 30 * 60;
/**
 * The story opens on focus, so the day needs focus worth leading with: 30 minutes keeps a first card
 * like "22m of focus" (often followed by hours of drift) off the first impression.
 */
export const FIRST_DAY_RECAP_MIN_FOCUS_SECONDS = 30 * 60;
/** Drift shorter than this is reported as "almost none" instead of naming a source. */
export const FIRST_DAY_RECAP_MIN_DRIFT_SECONDS = 3 * 60;
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

export function resolveFirstDayRecap({
  segments,
  day,
  today,
  options,
  startOfDayMinutes = 0,
}: {
  readonly segments: readonly ActivitySegment[];
  readonly day: string;
  readonly today: string;
  readonly options?: ClassificationOptions;
  readonly startOfDayMinutes?: number;
}): { readonly recap: FirstDayRecap | null; readonly decisionReason: OnboardingIntroDecisionReason } {
  // The tutorial tells yesterday only: a whole, finished day. A prepared today (yesterday was too
  // thin) or day before keeps the sample cards (owner decision 2026-10-04).
  if (day !== shiftIsoDate(today, -1)) return { recap: null, decisionReason: day === today ? "prepared_today" : "prepared_other_day" };
  const timed = toTimed(segments, options, {
    startMs: logicalDayStartMs(day, startOfDayMinutes),
    endMs: logicalDayEndExclusiveMs(day, startOfDayMinutes),
  });
  const totals = emptyVerdictSeconds();
  if (timed.length === 0) return { recap: null, decisionReason: "no_usable_history" };
  for (const entry of timed) totals[entry.verdict] += entry.segment.durationSeconds;
  const classifiedSeconds = totals.focus + totals.neutral + totals.drift;
  if (classifiedSeconds < FIRST_DAY_RECAP_MIN_CLASSIFIED_SECONDS) return { recap: null, decisionReason: "below_classified_minimum" };
  if (totals.focus < FIRST_DAY_RECAP_MIN_FOCUS_SECONDS) return { recap: null, decisionReason: "below_focus_minimum" };
  const chart = chartOf(timed);
  if (!chart) return { recap: null, decisionReason: "no_chart" };

  const driftBySource = new Map<string, { source: FirstDaySource; seconds: number }>();
  for (const entry of timed) {
    if (entry.verdict !== "drift") continue;
    const source = firstDaySourceOf(entry.segment);
    const tally = driftBySource.get(source.key) ?? { source, seconds: 0 };
    tally.seconds += entry.segment.durationSeconds;
    driftBySource.set(source.key, tally);
  }
  const driftRanked = Array.from(driftBySource.values()).sort((left, right) => right.seconds - left.seconds);
  const topDrift = driftRanked[0] ?? null;
  const topDriftSite = driftRanked.find((entry) => entry.source.kind === "site")?.source ?? null;

  return { decisionReason: "story_ready", recap: {
    day,
    importedOnly: timed.every((entry) => isBrowserHistoryImportSegment(entry.segment)),
    focusSeconds: totals.focus,
    driftSeconds: totals.drift,
    neutralSeconds: totals.neutral,
    classifiedSeconds,
    longestFocus: chart.longestFocus,
    topDrift: topDrift && totals.drift >= FIRST_DAY_RECAP_MIN_DRIFT_SECONDS ? topDrift : null,
    topDriftSite,
    firstHour: chart.firstHour,
    hourCount: chart.hourCount,
    blocks: chart.blocks,
  } };
}

/** Existing callers only need the local recap, never the observation reason. */
export function buildFirstDayRecap(input: Parameters<typeof resolveFirstDayRecap>[0]): FirstDayRecap | null {
  return resolveFirstDayRecap(input).recap;
}
