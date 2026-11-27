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

const BRAND_SKIP = new Set(["www", "m", "co", "com", "net", "org", "ac", "or", "go", "ne"]);

/** The names a source goes by in its titles: "youtube" for youtube.com, "x" for x.com, an app's own name. */
function brandsOf(source: FirstDaySource): readonly string[] {
  if (source.kind !== "site") return [source.label.trim().toLowerCase()];
  const labels = source.label.toLowerCase().split(".");
  return Array.from(new Set([labels[0], labels[labels.length - 2]].filter((label): label is string => Boolean(label) && !BRAND_SKIP.has(label))));
}

/** Whether a lowercased title names the brand; a short one ("x") only as a whole word. */
function mentionsBrand(text: string, brand: string): boolean {
  if (brand.length >= 4) return text.includes(brand);
  const escaped = brand.replace(/[.*+?^$\{\}()|[\]\\]/gu, "\\$&");
  return new RegExp("(^|[^\\p{L}\\p{N}])" + escaped + "($|[^\\p{L}\\p{N}])", "u").test(text);
}

const TITLE_TAIL = /^(.*\S)\s+[-–—|•·⋅/]\s+([^-–—|•·⋅/]+)$/u;

/** A page title the way a person would say it, without an unread count or the site's own name: "(3) Street food tour - YouTube" is "Street food tour". */
export function storyTitle(title: string, source: FirstDaySource): string {
  let text = title.trim().replace(/^\(\d+\+?\)\s*/u, "");
  const brands = brandsOf(source).map((brand) => brand.replace(/\s+/gu, ""));
  for (let pass = 0; pass < 2; pass += 1) {
    const match = TITLE_TAIL.exec(text);
    const tail = match?.[2].trim().toLowerCase().replace(/\s+/gu, "") ?? "";
    if (!match || !brands.some((brand) => tail === brand || (brand.length >= 2 && tail.includes(brand)) || (tail.length >= 3 && brand.includes(tail)))) break;
    text = match[1];
  }
  return text;
}

/**
 * Whether a title (through storyTitle) says what the page was about: more than its site's or app's own
 * name ("Jeju trip plan" on notion.so, not "Netflix" on netflix.com) and more than a bare "Home" or "검색".
 */
function titleTellsMore(title: string, source: FirstDaySource): boolean {
  const normalized = title.trim().toLowerCase();
  if (!normalized || normalized === source.label.toLowerCase() || brandsOf(source).some((brand) => mentionsBrand(normalized, brand))) return false;
  const letters = normalized.replace(/[^\p{L}\p{N}]/gu, "");
  if (/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(normalized)) return letters.length >= 4;
  return normalized.split(/\s+/u).length >= 2 && letters.length >= 8;
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

/**
 * One drawn block: its column (an hour, or a day in a story of the recent days; 0 = the chart's first),
 * its minute range inside that column (see FirstDayRecap.columnMinutes), its verdict, source and category.
 */
export type FirstDayRecapBlock = readonly [hourIndex: number, fromMinute: number, toMinute: number, verdict: FirstDayVerdict, sourceKey?: string, category?: ActivityCategory];
export type FirstDayRecapMoment = { readonly hourIndex: number; readonly minute: number };

/**
 * The day the story tells, relative to today. First-run preparation picks yesterday, then today, then
 * the day before (useFirstDayPreparation), and the 72-hour browser-history import covers each of them
 * whole up to now, so the story tells whichever it prepared; today's title reads "so far" because it is
 * still going. When no single day holds enough but the three together do, the story tells the recent
 * days ("recentDays"): the day before yesterday, yesterday and today so far.
 */
export type FirstDayStoryDay = "yesterday" | "today" | "dayBefore" | "recentDays";

/**
 * How much focus the day held. Every story opens on the day sorted by kind; "focus" (30 minutes or more)
 * and "overview" (5 to 30) follow it with a card on the focus, and "kinds" (under 5) has no stretch worth
 * pointing at, so it goes from the day by kind straight to the drift. The first two differ only in their
 * onboarding_intro label (story_ready, story_low_focus).
 */
export type FirstDayStoryLead = "focus" | "overview" | "kinds";

export type FirstDayRecap = {
  /** The day told; for the recent days, the last of them (today). */
  readonly day: string;
  readonly dayRelation: FirstDayStoryDay;
  /** The logical days a story of the recent days covers, oldest first; absent for one day. */
  readonly days?: readonly string[];
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
    /** The page or window title that held most of the stretch on its source, when it says more than the source's name. */
    readonly title?: string;
  } | null;
  readonly topDrift: { readonly seconds: number; readonly source: FirstDaySource } | null;
  /** Classified time by category, longest first. */
  readonly categories: readonly { readonly category: ActivityCategory; readonly seconds: number }[];
  /** The site with the most drift (any amount), so the Automatic close preview can close a real tab even when the top drift was an app. */
  readonly topDriftSite: FirstDaySource | null;
  /**
   * Clock hour (0-23) of the chart's first column when columns are hours; for days, the hour each day
   * starts at (the start of the logical day).
   */
  readonly firstHour: number;
  /** How many columns the chart has (hours, or days for the recent days). */
  readonly hourCount: number;
  /** Minutes one column spans: 60 for an hour, the whole logical day (1440) for a day. */
  readonly columnMinutes: number;
  readonly blocks: readonly FirstDayRecapBlock[];
};

/**
 * Below this much classified time there is nothing honest to say; the intro keeps its sample cards.
 * 20 minutes (30 until 2026-11-27), lowered step by step to reach more first days.
 */
export const FIRST_DAY_RECAP_MIN_CLASSIFIED_SECONDS = 20 * 60;
/** From this much focus the day is a full focus day (story_ready); below it, story_low_focus. Both show the focus card. */
export const FIRST_DAY_RECAP_MIN_FOCUS_SECONDS = 30 * 60;
/** Under this much focus there is no stretch worth pointing at: the story has no focus card (story_no_focus). */
export const FIRST_DAY_RECAP_MIN_OVERVIEW_FOCUS_SECONDS = 5 * 60;
/** Drift shorter than this is reported as "almost none" instead of naming a source. */
export const FIRST_DAY_RECAP_MIN_DRIFT_SECONDS = 3 * 60;
const FOCUS_RUN_MAX_GAP_MS = 5 * 60 * 1000;
const MIN_CHART_HOURS = 8;
/** A day of under an hour gets a narrower chart, so its few visits are not lost among empty hours. */
const MIN_CHART_HOURS_SHORT_DAY = 4;
const HOUR_MS = 60 * 60 * 1000;

type TimedSegment = { readonly segment: ActivitySegment; readonly startMs: number; readonly endMs: number; readonly verdict: FirstDayVerdict; readonly category: ActivityCategory };

/**
 * The day as the Today canvas draws it: one column per local clock hour, blocks by minute. The recent
 * days have one column per logical day, blocks by minute into that day; the story stacks each day's
 * minutes into one bar, so a few short visits still show how much each day held.
 */
export type FirstDayChart = {
  readonly firstHour: number;
  readonly hourCount: number;
  readonly columnMinutes: number;
  readonly blocks: readonly FirstDayRecapBlock[];
  /** The longest focus stretch on the chart (focus joined across gaps of up to five minutes). */
  readonly longestFocus: {
    readonly seconds: number;
    readonly startedAt: string;
    readonly source: FirstDaySource;
    readonly from: FirstDayRecapMoment;
    readonly to: FirstDayRecapMoment;
    readonly title?: string;
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
    timed.push({ segment, startMs, endMs, ...verdictOf(segment, options) });
  }
  return timed.sort((left, right) => left.startMs - right.startMs);
}

/** The longest focus stretch (focus joined across gaps of up to five minutes), placed on a chart. */
function longestFocusOf(timed: readonly TimedSegment[], momentAt: (ms: number) => FirstDayRecapMoment): FirstDayChart["longestFocus"] {
  type Run = {
    seconds: number; startMs: number; endMs: number;
    sources: Map<string, { source: FirstDaySource; seconds: number; titles: Map<string, number> }>;
  };
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
    const tally = run.sources.get(source.key) ?? { source, seconds: 0, titles: new Map<string, number>() };
    tally.seconds += seconds;
    const title = storyTitle(entry.segment.siteTitle ?? entry.segment.windowTitle ?? "", source);
    if (title && titleTellsMore(title, source)) tally.titles.set(title, (tally.titles.get(title) ?? 0) + seconds);
    run.sources.set(source.key, tally);
  }
  const longest = runs.reduce<Run | null>((best, candidate) => (best === null || candidate.seconds > best.seconds ? candidate : best), null);
  const longestTally = longest
    ? Array.from(longest.sources.values()).sort((left, right) => right.seconds - left.seconds)[0] ?? null
    : null;
  if (!longest || !longestTally) return null;
  const longestTitle = Array.from(longestTally.titles.entries()).sort((left, right) => right[1] - left[1])[0]?.[0];
  return {
    seconds: Math.round(longest.seconds),
    startedAt: new Date(longest.startMs).toISOString(),
    source: longestTally.source,
    from: momentAt(longest.startMs),
    to: momentAt(longest.endMs),
    ...(longestTitle ? { title: longestTitle } : {}),
  };
}

function chartOf(timed: readonly TimedSegment[]): FirstDayChart | null {
  if (timed.length === 0) return null;
  // Columns follow local clock hours, starting at the first hour with activity.
  const firstStart = new Date(timed[0].startMs);
  firstStart.setMinutes(0, 0, 0);
  const baseMs = firstStart.getTime();
  const lastEndMs = Math.max(...timed.map((entry) => entry.endMs));
  const countedSeconds = timed.reduce((total, entry) => total + entry.segment.durationSeconds, 0);
  const hourCount = Math.max(countedSeconds < 60 * 60 ? MIN_CHART_HOURS_SHORT_DAY : MIN_CHART_HOURS, Math.ceil((lastEndMs - baseMs) / HOUR_MS));
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
  return { firstHour: firstStart.getHours(), hourCount, columnMinutes: 60, blocks, longestFocus: longestFocusOf(timed, momentAt) };
}

/**
 * The recent days: one column per logical day, oldest first, each visit split at the days' edges and
 * placed by its minutes into its day.
 */
function daysChartOf(timed: readonly TimedSegment[], days: readonly string[], startOfDayMinutes: number): FirstDayChart | null {
  if (timed.length === 0) return null;
  const dayStarts = days.map((day) => logicalDayStartMs(day, startOfDayMinutes));
  const dayEnds = days.map((day) => logicalDayEndExclusiveMs(day, startOfDayMinutes));
  const columnOf = (ms: number) => {
    const index = dayEnds.findIndex((end) => ms < end);
    return index < 0 ? days.length - 1 : Math.max(0, index);
  };
  // Each visit split at the days' edges, starting at its minute into its day. A piece is as long as the
  // time it counts (a tracker's active time can run past a visit's clock span), so each day's bar adds
  // up to the minutes the story tells.
  const pieces: { readonly entry: TimedSegment; readonly column: number; readonly from: number; readonly to: number }[] = [];
  for (const entry of timed) {
    const counted = entry.segment.durationSeconds / ((entry.endMs - entry.startMs) / 1000);
    let cursor = entry.startMs;
    while (cursor < entry.endMs) {
      const column = columnOf(cursor);
      const until = Math.min(entry.endMs, dayEnds[column]);
      if (until <= cursor) break;
      const from = (cursor - dayStarts[column]) / 60_000;
      pieces.push({ entry, column, from, to: from + ((until - cursor) / 60_000) * counted });
      cursor = until;
    }
  }
  if (pieces.length === 0) return null;
  // A logical day runs 23 to 25 hours across a clock change; its column still spans 24.
  const columnMinutes = 24 * 60;
  // Every piece counts, however short: the story stacks each day's minutes, and a tracker records many
  // visits of a few seconds.
  const blocks: FirstDayRecapBlock[] = pieces
    .map((piece) => [piece.column, piece.from, piece.to, piece.entry.verdict, firstDaySourceOf(piece.entry.segment).key, piece.entry.category]);
  const momentAt = (ms: number): FirstDayRecapMoment => {
    const column = columnOf(ms);
    return { hourIndex: column, minute: Math.max(0, (ms - dayStarts[column]) / 60_000) };
  };
  return {
    firstHour: Math.floor(startOfDayMinutes / 60) % 24,
    hourCount: days.length,
    columnMinutes,
    blocks,
    longestFocus: longestFocusOf(timed, momentAt),
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

type FirstDayDecision = { readonly recap: FirstDayRecap | null; readonly decisionReason: OnboardingIntroDecisionReason };

/**
 * The story of the counted visits, once it is known which day or days they tell. Under the classified
 * minimum there is no story: when the visits' recorded time reaches the minimum, the rest is time Drifty
 * has not sorted yet (still classifying, or a window with no page) and the reason says so.
 */
function tellRecap(
  timed: readonly TimedSegment[],
  { day, dayRelation, days, chart }: {
    readonly day: string;
    readonly dayRelation: FirstDayStoryDay;
    readonly days?: readonly string[];
    readonly chart: (timed: readonly TimedSegment[]) => FirstDayChart | null;
  },
): FirstDayDecision {
  const totals = emptyVerdictSeconds();
  if (timed.length === 0) return { recap: null, decisionReason: "no_usable_history" };
  for (const entry of timed) totals[entry.verdict] += entry.segment.durationSeconds;
  const classifiedSeconds = totals.focus + totals.neutral + totals.drift;
  if (classifiedSeconds < FIRST_DAY_RECAP_MIN_CLASSIFIED_SECONDS) {
    const recordedSeconds = classifiedSeconds + totals.pending;
    return { recap: null, decisionReason: recordedSeconds >= FIRST_DAY_RECAP_MIN_CLASSIFIED_SECONDS ? "below_classified_unsorted" : "below_classified_minimum" };
  }
  const lead: FirstDayStoryLead = totals.focus >= FIRST_DAY_RECAP_MIN_FOCUS_SECONDS ? "focus"
    : totals.focus >= FIRST_DAY_RECAP_MIN_OVERVIEW_FOCUS_SECONDS ? "overview" : "kinds";
  const drawn = chart(timed);
  if (!drawn) return { recap: null, decisionReason: "no_chart" };

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

  const byCategory = new Map<ActivityCategory, number>();
  for (const entry of timed) {
    if (entry.verdict !== "pending") byCategory.set(entry.category, (byCategory.get(entry.category) ?? 0) + entry.segment.durationSeconds);
  }
  const categories = Array.from(byCategory, ([category, seconds]) => ({ category, seconds })).sort((left, right) => right.seconds - left.seconds);

  return { decisionReason: lead === "focus" ? "story_ready" : lead === "overview" ? "story_low_focus" : "story_no_focus", recap: {
    day,
    dayRelation,
    ...(days ? { days } : {}),
    lead,
    importedOnly: timed.every((entry) => isBrowserHistoryImportSegment(entry.segment)),
    focusSeconds: totals.focus,
    driftSeconds: totals.drift,
    neutralSeconds: totals.neutral,
    classifiedSeconds,
    longestFocus: drawn.longestFocus,
    topDrift: topDrift && totals.drift >= FIRST_DAY_RECAP_MIN_DRIFT_SECONDS ? topDrift : null,
    categories,
    topDriftSite,
    firstHour: drawn.firstHour,
    hourCount: drawn.hourCount,
    columnMinutes: drawn.columnMinutes,
    blocks: drawn.blocks,
  } };
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
}): FirstDayDecision {
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
  return tellRecap(timed, { day, dayRelation, chart: chartOf });
}

/** The three logical days the first-run import covers, oldest first: the day before yesterday, yesterday, today. */
export function firstDayRecentDays(today: string): readonly string[] {
  return [shiftIsoDate(today, -2), shiftIsoDate(today, -1), today];
}

/**
 * The story of the recent days together: the three logical days the first-run import covers, under the
 * same minimums as one day. A segment may come from any of them; each is counted once.
 */
export function resolveFirstDayRecentDaysRecap({
  segments,
  today,
  options,
  startOfDayMinutes = 0,
}: {
  readonly segments: readonly ActivitySegment[];
  readonly today: string;
  readonly options?: ClassificationOptions;
  readonly startOfDayMinutes?: number;
}): FirstDayDecision {
  const days = firstDayRecentDays(today);
  const unique = Array.from(new Map(segments.map((segment) => [segment.id, segment])).values());
  const timed = toTimed(unique, options, {
    startMs: logicalDayStartMs(days[0], startOfDayMinutes),
    endMs: logicalDayEndExclusiveMs(today, startOfDayMinutes),
  });
  return tellRecap(timed, { day: today, dayRelation: "recentDays", days, chart: (entries) => daysChartOf(entries, days, startOfDayMinutes) });
}

/** Whether a day's decision leaves room for the recent days together to tell a story instead. */
export function firstDayStoryMayUseRecentDays(reason: OnboardingIntroDecisionReason): boolean {
  return reason === "below_classified_minimum" || reason === "below_classified_unsorted" || reason === "no_usable_history";
}

/**
 * The first-day story: the prepared day when it holds enough; otherwise, when the segments of the recent
 * days are at hand, the three days together. A day that cannot be told keeps its own reason.
 */
export function resolveFirstDayStory(input: Parameters<typeof resolveFirstDayRecap>[0] & {
  /** Every segment of the three recent days, when they have been read. */
  readonly recentSegments?: readonly ActivitySegment[];
}): FirstDayDecision {
  const single = resolveFirstDayRecap(input);
  if (single.recap || !input.recentSegments || !firstDayStoryMayUseRecentDays(single.decisionReason)) return single;
  const recent = resolveFirstDayRecentDaysRecap({ ...input, segments: input.recentSegments });
  return recent.recap ? recent : single;
}

/** Existing callers only need the local recap, never the observation reason. */
export function buildFirstDayRecap(input: Parameters<typeof resolveFirstDayRecap>[0]): FirstDayRecap | null {
  return resolveFirstDayRecap(input).recap;
}

/** Whether the story has a card on the day's focus: not on a day with almost no focus (see FirstDayStoryLead). */
export function storyHasFocusCard(recap: FirstDayRecap): boolean {
  return recap.lead !== "kinds" && recap.longestFocus !== null;
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
