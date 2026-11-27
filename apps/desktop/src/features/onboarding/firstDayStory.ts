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

/** One drawn block: hour column (0 = the chart's first hour), minute range inside it, its verdict, source and category. */
export type FirstDayRecapBlock = readonly [hourIndex: number, fromMinute: number, toMinute: number, verdict: FirstDayVerdict, sourceKey?: string, category?: ActivityCategory];
export type FirstDayRecapMoment = { readonly hourIndex: number; readonly minute: number };

/**
 * The day the story tells, relative to today. First-run preparation picks yesterday, then today, then
 * the day before (useFirstDayPreparation), and the 72-hour browser-history import covers each of them
 * whole up to now, so the story tells whichever it prepared; today's title reads "so far" because it is
 * still going.
 */
export type FirstDayStoryDay = "yesterday" | "today" | "dayBefore";

/**
 * How much focus the day held. Every story opens on the day sorted by kind; "focus" (30 minutes or more)
 * and "overview" (5 to 30) follow it with a card on the focus, and "kinds" (under 5) has no stretch worth
 * pointing at, so it goes from the day by kind straight to the drift. The first two differ only in their
 * onboarding_intro label (story_ready, story_low_focus).
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
    /** The page or window title that held most of the stretch on its source, when it says more than the source's name. */
    readonly title?: string;
  } | null;
  readonly topDrift: { readonly seconds: number; readonly source: FirstDaySource } | null;
  /** Classified time by category, longest first. */
  readonly categories: readonly { readonly category: ActivityCategory; readonly seconds: number }[];
  /** The site with the most drift (any amount), so the Automatic close preview can close a real tab even when the top drift was an app. */
  readonly topDriftSite: FirstDaySource | null;
  /** Clock hour (0-23) of the chart's first column. */
  readonly firstHour: number;
  readonly hourCount: number;
  readonly blocks: readonly FirstDayRecapBlock[];
};

/** Below this much classified time the day has nothing honest to say; the intro keeps its sample cards. */
export const FIRST_DAY_RECAP_MIN_CLASSIFIED_SECONDS = 30 * 60;
/** From this much focus the day is a full focus day (story_ready); below it, story_low_focus. Both show the focus card. */
export const FIRST_DAY_RECAP_MIN_FOCUS_SECONDS = 30 * 60;
/** Under this much focus there is no stretch worth pointing at: the story has no focus card (story_no_focus). */
export const FIRST_DAY_RECAP_MIN_OVERVIEW_FOCUS_SECONDS = 5 * 60;
/** Drift shorter than this is reported as "almost none" instead of naming a source. */
export const FIRST_DAY_RECAP_MIN_DRIFT_SECONDS = 3 * 60;
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
  const longestSource = longestTally?.source ?? null;
  const longestTitle = longestTally
    ? Array.from(longestTally.titles.entries()).sort((left, right) => right[1] - left[1])[0]?.[0]
    : undefined;
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
      ...(longestTitle ? { title: longestTitle } : {}),
    } : null,
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
  for (const entry of timed) {
    if (entry.verdict === "pending") continue;
    if (entry.verdict !== "drift") continue;
    const source = firstDaySourceOf(entry.segment);
    const tally = driftBySource.get(source.key) ?? { source, seconds: 0 };
    tally.seconds += entry.segment.durationSeconds;
    driftBySource.set(source.key, tally);
  }
  const driftRanked = Array.from(driftBySource.values()).sort((left, right) => right.seconds - left.seconds);
  const topDrift = driftRanked[0] ?? null;
  const topDriftSite = driftRanked.find((entry) => entry.source.kind === "site")?.source ?? null;

  const classifiedEntries = timed.filter((entry) => entry.verdict !== "pending");
  const byCategory = new Map<ActivityCategory, number>();
  for (const entry of classifiedEntries) byCategory.set(entry.category, (byCategory.get(entry.category) ?? 0) + entry.segment.durationSeconds);
  const categories = Array.from(byCategory, ([category, seconds]) => ({ category, seconds })).sort((left, right) => right.seconds - left.seconds);

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
    categories,
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
