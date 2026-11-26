import {
  classifyActivityDetailed,
  isBrowserHistoryImportSegment,
  isExcludedSegment,
  isFailedForegroundCaptureSegment,
  logicalDayEndExclusiveMs,
  logicalDayStartMs,
  shiftIsoDate,
  type ActivitySegment,
  type ActivityCategory,
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

/** Whether a page or window title says more than its site's or app's own name ("Jeju trip plan" on notion.so, not "Netflix" on netflix.com). */
function titleTellsMore(title: string, source: FirstDaySource): boolean {
  const brand = (source.kind === "site" ? source.label.split(".")[0] : source.label).toLowerCase();
  const normalized = title.trim().toLowerCase();
  return normalized.length > 0 && normalized !== source.label.toLowerCase() && !normalized.includes(brand);
}

function verdictOf(segment: ActivitySegment, options?: ClassificationOptions): { readonly verdict: FirstDayVerdict; readonly category: ActivityCategory } {
  const classification = classifyActivityDetailed(segment, options);
  return {
    verdict: classification.category === "unknown" ? "pending" : classification.productivity,
    category: classification.category,
  };
}

type VerdictSeconds = Record<FirstDayVerdict, number>;
const emptyVerdictSeconds = (): VerdictSeconds => ({ focus: 0, neutral: 0, drift: 0, pending: 0 });

/** One drawn block: hour column (0 = the chart's first hour), minute range inside it, its verdict, source and category. */
export type FirstDayRecapBlock = readonly [hourIndex: number, fromMinute: number, toMinute: number, verdict: FirstDayVerdict, sourceKey?: string, category?: ActivityCategory];
export type FirstDayRecapMoment = { readonly hourIndex: number; readonly minute: number };

/** One stay on a place: consecutive visits to the same source joined across gaps of up to five minutes. */
export type FirstDayStay = {
  readonly seconds: number;
  readonly startedAt: string;
  readonly source: FirstDaySource;
  readonly from: FirstDayRecapMoment;
  readonly to: FirstDayRecapMoment;
};

/**
 * The day the story tells, relative to today. First-run preparation picks yesterday, then today, then
 * the day before (useFirstDayPreparation), and the 72-hour browser-history import covers each of them
 * whole up to now, so the story tells whichever it prepared; today's title reads "so far" because it is
 * still going.
 */
export type FirstDayStoryDay = "yesterday" | "today" | "dayBefore";

/**
 * How the first story card opens: on focus; or, when focus fell short of the focus lead's minimum, on
 * the classified time it read, with the focus it found in the body ("overview"); or, with almost no
 * focus, on the classified time it read sorted by kind ("kinds").
 */
export type FirstDayStoryLead = "focus" | "overview" | "kinds";

export type FirstDayRecap = {
  readonly day: string;
  readonly dayRelation: FirstDayStoryDay;
  readonly lead: FirstDayStoryLead;
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
  /** Up to three sources with the most classified time, whatever their verdict: where a day with almost no focus went. */
  readonly topSources: readonly { readonly seconds: number; readonly source: FirstDaySource }[];
  /** Classified time by category, longest first. */
  readonly categories: readonly { readonly category: ActivityCategory; readonly seconds: number }[];
  /** The first and last classified moment of the day. */
  readonly span: { readonly startedAt: string; readonly endedAt: string } | null;
  /** The two neighbouring chart hours that held the most classified time (hour indexes, end exclusive). */
  readonly busiestHours: { readonly fromHour: number; readonly toHour: number; readonly seconds: number } | null;
  /** How the day moved between places: separate stays, their average length and the longest one. */
  readonly stays: { readonly count: number; readonly averageSeconds: number; readonly longest: FirstDayStay | null };
  /** Up to three long classified visits in different categories with the page title Drifty read: how it sorted the day. */
  readonly examples: readonly { readonly title: string; readonly source: FirstDaySource; readonly category: ActivityCategory; readonly seconds: number }[];
  /** How many classified records the day held. */
  readonly visitCount: number;
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
/**
 * Below the focus lead's minimum the story opens on the classified time instead and names the longest
 * focus stretch in the body; under this much focus there is no stretch worth pointing at, so the story
 * names where the time went instead.
 */
export const FIRST_DAY_RECAP_MIN_OVERVIEW_FOCUS_SECONDS = 5 * 60;
/** Drift shorter than this is reported as "almost none" instead of naming a source. */
export const FIRST_DAY_RECAP_MIN_DRIFT_SECONDS = 3 * 60;
/** How many places a story with almost no focus names. */
const FIRST_DAY_RECAP_TOP_SOURCE_COUNT = 3;
const FOCUS_RUN_MAX_GAP_MS = 5 * 60 * 1000;
const MIN_CHART_HOURS = 8;
const HOUR_MS = 60 * 60 * 1000;

type TimedSegment = { readonly segment: ActivitySegment; readonly startMs: number; readonly endMs: number; readonly verdict: FirstDayVerdict; readonly category: ActivityCategory };

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
  /** Every stay on one place, in time order (classified time only). */
  readonly stays: readonly FirstDayStay[];
  /** The two neighbouring hour columns with the most classified time. */
  readonly busiestHours: { readonly fromHour: number; readonly toHour: number; readonly seconds: number } | null;
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
    timed.push({ segment, startMs, endMs, ...verdictOf(segment, options) });
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
      if (toMinute - fromMinute >= 0.5) blocks.push([hourIndex, fromMinute, toMinute, entry.verdict, firstDaySourceOf(entry.segment).key, entry.category]);
      cursor = until;
    }
  }

  // Stays: classified visits to one place, joined while the next visit to it follows within five minutes.
  type Stay = { seconds: number; startMs: number; endMs: number; source: FirstDaySource };
  const stayRuns: Stay[] = [];
  for (const entry of timed) {
    if (entry.verdict === "pending") continue;
    const source = firstDaySourceOf(entry.segment);
    const last = stayRuns[stayRuns.length - 1];
    const seconds = (entry.endMs - entry.startMs) / 1000;
    if (last && last.source.key === source.key && entry.startMs <= last.endMs + FOCUS_RUN_MAX_GAP_MS) {
      last.seconds += seconds;
      last.endMs = Math.max(last.endMs, entry.endMs);
    } else {
      stayRuns.push({ seconds, startMs: entry.startMs, endMs: entry.endMs, source });
    }
  }
  const stays: FirstDayStay[] = stayRuns.map((stay) => ({
    seconds: Math.round(stay.seconds),
    startedAt: new Date(stay.startMs).toISOString(),
    source: stay.source,
    from: momentAt(stay.startMs),
    to: momentAt(stay.endMs),
  }));

  const classifiedMinutesByHour = Array.from({ length: hourCount }, () => 0);
  for (const block of blocks) if (block[3] !== "pending") classifiedMinutesByHour[block[0]] += block[2] - block[1];
  let busiestHours: FirstDayChart["busiestHours"] = null;
  for (let hour = 0; hour + 1 < hourCount; hour += 1) {
    const minutes = classifiedMinutesByHour[hour] + classifiedMinutesByHour[hour + 1];
    if (minutes > 0 && (!busiestHours || minutes * 60 > busiestHours.seconds)) {
      busiestHours = { fromHour: hour, toHour: hour + 2, seconds: Math.round(minutes * 60) };
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
    stays,
    busiestHours,
  };
}

/**
 * Seconds of countable activity on the logical day, summed the way the recap sums its totals (whole
 * segment durations of segments overlapping the day). Classified time is part of this, so a day under
 * the classified minimum here cannot pass it once classified. Preparation uses it to choose a day.
 */
export function firstDayRecordedSeconds({
  segments,
  day,
  startOfDayMinutes = 0,
}: {
  readonly segments: readonly ActivitySegment[];
  readonly day: string;
  readonly startOfDayMinutes?: number;
}): number {
  const dayStartMs = logicalDayStartMs(day, startOfDayMinutes);
  const dayEndMs = logicalDayEndExclusiveMs(day, startOfDayMinutes);
  let seconds = 0;
  for (const segment of segments) {
    if (!isCountable(segment)) continue;
    const startMs = Date.parse(segment.startedAt);
    const endMs = Date.parse(segment.endedAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    if (Math.min(Math.max(endMs, startMs), dayEndMs) <= Math.max(startMs, dayStartMs)) continue;
    seconds += segment.durationSeconds;
  }
  return seconds;
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
  // The story tells the day first-run prepared when it holds enough: yesterday, today or the day before.
  // Any other day keeps the sample cards.
  const dayRelation: FirstDayStoryDay | null = day === shiftIsoDate(today, -1) ? "yesterday"
    : day === today ? "today"
      : day === shiftIsoDate(today, -2) ? "dayBefore" : null;
  if (!dayRelation) return { recap: null, decisionReason: "prepared_other_day" };
  const timed = toTimed(segments, options, {
    startMs: logicalDayStartMs(day, startOfDayMinutes),
    endMs: logicalDayEndExclusiveMs(day, startOfDayMinutes),
  });
  const totals = emptyVerdictSeconds();
  if (timed.length === 0) return { recap: null, decisionReason: "no_usable_history" };
  for (const entry of timed) totals[entry.verdict] += entry.segment.durationSeconds;
  const classifiedSeconds = totals.focus + totals.neutral + totals.drift;
  if (classifiedSeconds < FIRST_DAY_RECAP_MIN_CLASSIFIED_SECONDS) return { recap: null, decisionReason: "below_classified_minimum" };
  const lead: FirstDayStoryLead = totals.focus >= FIRST_DAY_RECAP_MIN_FOCUS_SECONDS ? "focus"
    : totals.focus >= FIRST_DAY_RECAP_MIN_OVERVIEW_FOCUS_SECONDS ? "overview" : "kinds";
  const chart = chartOf(timed);
  if (!chart) return { recap: null, decisionReason: "no_chart" };

  const driftBySource = new Map<string, { source: FirstDaySource; seconds: number }>();
  const classifiedBySource = new Map<string, { source: FirstDaySource; seconds: number }>();
  for (const entry of timed) {
    if (entry.verdict === "pending") continue;
    const source = firstDaySourceOf(entry.segment);
    const classified = classifiedBySource.get(source.key) ?? { source, seconds: 0 };
    classified.seconds += entry.segment.durationSeconds;
    classifiedBySource.set(source.key, classified);
    if (entry.verdict !== "drift") continue;
    const tally = driftBySource.get(source.key) ?? { source, seconds: 0 };
    tally.seconds += entry.segment.durationSeconds;
    driftBySource.set(source.key, tally);
  }
  const driftRanked = Array.from(driftBySource.values()).sort((left, right) => right.seconds - left.seconds);
  const topDrift = driftRanked[0] ?? null;
  const topDriftSite = driftRanked.find((entry) => entry.source.kind === "site")?.source ?? null;
  const topSources = Array.from(classifiedBySource.values()).sort((left, right) => right.seconds - left.seconds).slice(0, FIRST_DAY_RECAP_TOP_SOURCE_COUNT);

  const classifiedEntries = timed.filter((entry) => entry.verdict !== "pending");
  const byCategory = new Map<ActivityCategory, number>();
  for (const entry of classifiedEntries) byCategory.set(entry.category, (byCategory.get(entry.category) ?? 0) + entry.segment.durationSeconds);
  const categories = Array.from(byCategory, ([category, seconds]) => ({ category, seconds })).sort((left, right) => right.seconds - left.seconds);
  const span = classifiedEntries.length > 0 ? {
    startedAt: new Date(classifiedEntries[0].startMs).toISOString(),
    endedAt: new Date(Math.max(...classifiedEntries.map((entry) => entry.endMs))).toISOString(),
  } : null;
  const longestStay = chart.stays.reduce<FirstDayStay | null>((best, stay) => (best === null || stay.seconds > best.seconds ? stay : best), null);
  // One visit per category, preferring a title that says more than the site's own name ("Jeju trip plan"
  // over "Netflix"), then the longest: real titles Drifty read and how it sorted them.
  const exampleOf = (entry: TimedSegment) => {
    const source = firstDaySourceOf(entry.segment);
    const title = (entry.segment.siteTitle ?? entry.segment.windowTitle ?? "").trim() || source.label;
    return { title, source, category: entry.category, seconds: entry.segment.durationSeconds, telling: titleTellsMore(title, source) };
  };
  const exampleByCategory = new Map<ActivityCategory, ReturnType<typeof exampleOf>>();
  for (const entry of classifiedEntries) {
    const candidate = exampleOf(entry);
    const current = exampleByCategory.get(entry.category);
    if (!current || Number(candidate.telling) - Number(current.telling) > 0
      || (candidate.telling === current.telling && candidate.seconds > current.seconds)) exampleByCategory.set(entry.category, candidate);
  }
  const examples = Array.from(exampleByCategory.values())
    .sort((left, right) => Number(right.telling) - Number(left.telling) || right.seconds - left.seconds)
    .slice(0, FIRST_DAY_RECAP_TOP_SOURCE_COUNT)
    .map(({ title, source, category, seconds }) => ({ title, source, category, seconds }));

  return { decisionReason: lead === "focus" ? "story_ready" : lead === "overview" ? "story_low_focus" : "story_no_focus", recap: {
    day,
    dayRelation,
    lead,
    importedOnly: timed.every((entry) => isBrowserHistoryImportSegment(entry.segment)),
    focusSeconds: totals.focus,
    driftSeconds: totals.drift,
    neutralSeconds: totals.neutral,
    classifiedSeconds,
    longestFocus: chart.longestFocus,
    topDrift: topDrift && totals.drift >= FIRST_DAY_RECAP_MIN_DRIFT_SECONDS ? topDrift : null,
    topSources,
    categories,
    span,
    busiestHours: chart.busiestHours,
    stays: {
      count: chart.stays.length,
      averageSeconds: chart.stays.length > 0 ? Math.round(chart.stays.reduce((total, stay) => total + stay.seconds, 0) / chart.stays.length) : 0,
      longest: longestStay,
    },
    examples,
    visitCount: classifiedEntries.length,
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

/**
 * What first-run preparation learned about the history it could read, so a sample intro can say why
 * (as a fixed label, never the facts themselves): whether the browser-history import was chosen,
 * whether Safari is the default browser while its history is unreadable, and the recorded time of the
 * three days the import covers taken together. Null facts leave the reason as it was.
 */
export type FirstDayPreparedFacts = {
  readonly importEnabled: boolean;
  readonly safariLocked: boolean | null;
  readonly windowRecordedSeconds: number | null;
};

/**
 * Splits the two broad sample-card reasons by what preparation saw: an empty day because the import was
 * off or Safari could not be read, and a short day whose three imported days together would have held
 * enough time. Every other reason, and either reason without facts, is unchanged.
 */
export function refineIntroDecisionReason(
  reason: OnboardingIntroDecisionReason,
  facts: FirstDayPreparedFacts | null,
): OnboardingIntroDecisionReason {
  if (!facts) return reason;
  if (reason === "no_usable_history") {
    if (!facts.importEnabled) return "no_history_import_off";
    if (facts.safariLocked) return "no_history_safari_locked";
    return reason;
  }
  if (reason === "below_classified_minimum" && facts.windowRecordedSeconds !== null
    && facts.windowRecordedSeconds >= FIRST_DAY_RECAP_MIN_CLASSIFIED_SECONDS) {
    return "below_classified_window_enough";
  }
  return reason;
}
