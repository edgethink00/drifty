import {
  activityTimeBounds,
  aggregateDeviceElapsedTime,
  classifyActivity,
  logicalDayEndExclusiveMs,
  logicalDayStartMs,
  shiftIsoDate,
  type ActivitySegment,
  type ClassificationOptions,
} from "@drifty/domain";
import { buildDayPatternMetrics, type DayPatternMetrics } from "../dashboard/dayPatternMetrics";
import { joinProductivityRuns } from "../../lib/productivityRuns";

/*
 * The numbers behind the Home preview (Dev mode, owner exploration
 * 2026-11-05). Everything is computed on this computer from the same
 * records Your Day reads; nothing here calls a model or leaves the device.
 */

/** A focus run at least this long counts as deep focus. */
export const DEEP_FOCUS_MIN_SECONDS = 25 * 60;
/** How many earlier same weekdays make "usual". */
export const BASELINE_WEEKS = 4;
/** A goal assumed when onboarding left the daily focus goal unset. */
export const DEFAULT_FOCUS_GOAL_HOURS = 4;
/** The focus curve's step: cumulative focus every quarter hour of the logical day. */
export const CURVE_STEP_MINUTES = 15;
const CURVE_STEPS = (24 * 60) / CURVE_STEP_MINUTES;
/** A same weekday with less focus than this over the whole day was a day off, not a usual day. */
export const BASELINE_MIN_DAY_FOCUS_SECONDS = 30 * 60;
/** Drift at least this long between two stretches of focus counts as a break in focus. */
export const FOCUS_BREAK_MIN_DRIFT_SECONDS = 60;
/** The shortest stretch the activity list names: focus that held this long, drift that took this long. */
export const SESSION_MIN_FOCUS_SECONDS = 15 * 60;
export const SESSION_MIN_DRIFT_SECONDS = 5 * 60;
const MAX_TITLE_LENGTH = 48;

export type HomePhase = "morning" | "midday" | "evening";

export type HomeDaySlice = {
  readonly focus: number;
  readonly drift: number;
  readonly neutral: number;
  readonly tracked: number;
};

export type HomeWorkItem = {
  readonly id: string;
  /** A window or page title when there is one, else the app or site. */
  readonly label: string;
  /** The app or site the title belongs to. */
  readonly source: string;
  readonly seconds: number;
  /** For the app's icon beside the item. */
  readonly appName: string;
  readonly bundleId: string | null;
  readonly siteDomain: string | null;
};

/** Today's time per app or site and productivity, for the donut's hover list. */
export type HomeSource = {
  readonly productivity: "focus" | "drift" | "neutral";
  readonly appName: string;
  readonly bundleId: string | null;
  readonly siteDomain: string | null;
  readonly seconds: number;
};

export type HomeBaseline = {
  /** Earlier same weekdays with at least BASELINE_MIN_DAY_FOCUS_SECONDS of focus, at most BASELINE_WEEKS. */
  readonly days: number;
  /** Average over those days up to the same clock time. */
  readonly focus: number;
  readonly drift: number;
  /** Average over those whole days. */
  readonly fullDayFocus: number;
  readonly fullDayDrift: number;
  /** Average first record, minutes after the logical day start. */
  readonly firstStartMinutes: number | null;
  readonly switchesPerHour: number | null;
};

export type HomeWeekDay = {
  readonly day: string;
  readonly focus: number;
  readonly drift: number;
  readonly neutral: number;
  readonly goalMet: boolean;
  readonly longestFocus: { readonly startMs: number; readonly seconds: number } | null;
};

export type HomeModel = {
  readonly today: string;
  readonly asOfMs: number;
  readonly phase: HomePhase;
  readonly goalSeconds: number;
  readonly goalIsDefault: boolean;
  readonly now: HomeDaySlice;
  readonly sources: readonly HomeSource[];
  readonly pattern: DayPatternMetrics;
  readonly deepFocusSeconds: number;
  readonly firstStartMs: number | null;
  /** Today's first record, minutes after the logical day start. */
  readonly firstStartMinutes: number | null;
  readonly topFocusItem: HomeWorkItem | null;
  /** Today's three longest pieces of focused work, longest first. */
  readonly topFocusItems: readonly HomeWorkItem[];
  readonly topDrift: HomeWorkItem | null;
  /** Today's longest drift, up to five, longest first. */
  readonly topDrifts: readonly HomeWorkItem[];
  /** When today's latest drift ended, for the conversation layout. */
  readonly lastDriftEndMs: number | null;
  readonly baseline: HomeBaseline;
  /** Focus now minus usual focus by this time; null without a baseline. */
  readonly paceSeconds: number | null;
  readonly yesterday: {
    readonly day: string;
    readonly slice: HomeDaySlice;
    readonly topItems: readonly HomeWorkItem[];
    /** The work of the day's last long focus run: where to pick up. */
    readonly lastItem: HomeWorkItem | null;
    readonly lastEndMs: number | null;
    /** Yesterday's stretches, for the morning before today has any. */
    readonly sessions: readonly HomeSession[];
  } | null;
  /** Seven logical days ending today (today up to asOfMs). */
  readonly week: readonly HomeWeekDay[];
  readonly goalMetDays: number;
  /** Today's longest focus beats every other day of the last seven. */
  readonly weekRecord: boolean;
  /**
   * Focus added up through the day, one value per CURVE_STEP_MINUTES from the
   * logical day start: today up to the chosen time, and the average of the
   * same weekdays used for "usual" over their whole day.
   */
  readonly focusCurve: { readonly startMs: number; readonly today: readonly number[]; readonly usual: readonly number[] | null; readonly nowStep: number };
  /**
   * Today hour by hour from the logical day start (24 entries; today up to
   * the chosen time), with the usual focus in each hour on the same weekdays.
   */
  readonly hours: readonly HomeHour[];
  /**
   * Times focus gave way to at least FOCUS_BREAK_MIN_DRIFT_SECONDS of drift and
   * then came back (provisional, owner review 2026-11-06: focus quality is
   * settled as a place, its definition later).
   */
  readonly focusBreaks: number;
  /**
   * Today's stretches worth naming, oldest first: focus runs (the streak
   * rule) and drift runs, each with the work or site it was mostly on.
   */
  readonly sessions: readonly HomeSession[];
  /** When today's latest record ended, for the header's recording status; null without one. */
  readonly lastRecordMs: number | null;
};

export type HomeSession = {
  readonly kind: "focus" | "drift";
  readonly startMs: number;
  readonly endMs: number;
  readonly seconds: number;
  readonly item: HomeWorkItem | null;
};

export type HomeHour = {
  readonly startMs: number;
  readonly focus: number;
  readonly drift: number;
  readonly neutral: number;
  /** Usual focus in this hour; null without a usual day. */
  readonly usualFocus: number | null;
};

export type HomeModelInput = {
  readonly segments: readonly ActivitySegment[];
  readonly today: string;
  readonly asOfMs: number;
  readonly startOfDayMinutes: number;
  readonly classificationOptions?: ClassificationOptions;
  readonly goalHours: number | null;
};

const EMPTY_SLICE: HomeDaySlice = { focus: 0, drift: 0, neutral: 0, tracked: 0 };

type Classified = { readonly segment: ActivitySegment; readonly startMs: number; readonly endMs: number; readonly seconds: number; readonly productivity: "focus" | "drift" | "neutral" | "unknown" };

function classifyAll(segments: readonly ActivitySegment[], options?: ClassificationOptions): Classified[] {
  const out: Classified[] = [];
  for (const segment of aggregateDeviceElapsedTime(segments)) {
    const { start, end } = activityTimeBounds(segment);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const { category, productivity } = classifyActivity(segment, options);
    out.push({
      segment,
      startMs: start,
      endMs: end,
      seconds: Math.max(0, segment.durationSeconds),
      productivity: category === "unknown" ? "unknown" : productivity,
    });
  }
  return out;
}

/** The part of each record inside [fromMs, toMs), its seconds scaled to the overlap. */
function clip(records: readonly Classified[], fromMs: number, toMs: number): Classified[] {
  const out: Classified[] = [];
  for (const record of records) {
    const start = Math.max(record.startMs, fromMs);
    const end = Math.min(record.endMs, toMs);
    if (end <= start) continue;
    const share = (end - start) / (record.endMs - record.startMs);
    const seconds = record.seconds * share;
    if (seconds <= 0) continue;
    out.push({
      ...record,
      startMs: start,
      endMs: end,
      seconds,
      segment: share === 1 ? record.segment : {
        ...record.segment,
        startedAt: new Date(start).toISOString(),
        endedAt: new Date(end).toISOString(),
        durationSeconds: seconds,
      },
    });
  }
  return out;
}

function slice(records: readonly Classified[]): HomeDaySlice {
  let focus = 0, drift = 0, neutral = 0, tracked = 0;
  for (const record of records) {
    tracked += record.seconds;
    if (record.productivity === "focus") focus += record.seconds;
    else if (record.productivity === "drift") drift += record.seconds;
    else if (record.productivity === "neutral") neutral += record.seconds;
  }
  return { focus, drift, neutral, tracked };
}

function clipTitle(text: string): string {
  const trimmed = text.replace(/\s+/gu, " ").trim();
  return trimmed.length > MAX_TITLE_LENGTH ? trimmed.slice(0, MAX_TITLE_LENGTH - 1).trimEnd() + "…" : trimmed;
}

/** What a record was about: its window or page title, else its app or site. */
export function workItemOf(segment: ActivitySegment): Omit<HomeWorkItem, "seconds"> {
  const siteDomain = segment.siteDomain?.trim().replace(/^www\./u, "") || null;
  const source = siteDomain || segment.appName.trim() || "?";
  const icon = { appName: segment.appName, bundleId: segment.bundleId ?? null, siteDomain };
  const title = (segment.siteTitle?.trim() || segment.windowTitle?.trim() || "");
  if (title && title.toLowerCase() !== source.toLowerCase()) {
    return { id: source + "\u0000" + title, label: clipTitle(title), source, ...icon };
  }
  return { id: source, label: source, source, ...icon };
}

function topItems(records: readonly Classified[], productivity: "focus" | "drift", by: (segment: ActivitySegment) => Omit<HomeWorkItem, "seconds">, limit: number): HomeWorkItem[] {
  const items = new Map<string, HomeWorkItem>();
  for (const record of records) {
    if (record.productivity !== productivity) continue;
    const item = by(record.segment);
    const current = items.get(item.id);
    items.set(item.id, { ...item, seconds: (current?.seconds ?? 0) + record.seconds });
  }
  return [...items.values()].sort((a, b) => b.seconds - a.seconds).slice(0, limit);
}

function siteOrApp(segment: ActivitySegment): Omit<HomeWorkItem, "seconds"> {
  const siteDomain = segment.siteDomain?.trim().replace(/^www\./u, "") || null;
  const source = siteDomain || segment.appName.trim() || "?";
  return { id: source, label: source, source, appName: segment.appName, bundleId: segment.bundleId ?? null, siteDomain };
}

function sourcesOf(records: readonly Classified[]): HomeSource[] {
  const out = new Map<string, HomeSource>();
  for (const record of records) {
    if (record.productivity === "unknown") continue;
    const item = siteOrApp(record.segment);
    const key = record.productivity + "\u0000" + item.id;
    const current = out.get(key);
    out.set(key, { productivity: record.productivity, appName: item.appName, bundleId: item.bundleId, siteDomain: item.siteDomain, seconds: (current?.seconds ?? 0) + record.seconds });
  }
  return [...out.values()].sort((a, b) => b.seconds - a.seconds);
}

function patternOf(records: readonly Classified[], options?: ClassificationOptions): DayPatternMetrics {
  return buildDayPatternMetrics(records.map((record) => record.segment), options);
}

export function phaseAt(asOfMs: number, focusSecondsSoFar: number): HomePhase {
  const date = new Date(asOfMs);
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (minutes >= 18 * 60 || minutes < 4 * 60) return "evening";
  if (minutes < 11 * 60 + 30 && focusSecondsSoFar < 45 * 60) return "morning";
  return "midday";
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

/** Focus seconds added up at the end of every curve step after dayStartMs. */
function cumulativeFocus(records: readonly Classified[], dayStartMs: number): number[] {
  let total = 0;
  return perStep(records, dayStartMs, CURVE_STEP_MINUTES, "focus").map((seconds) => (total += seconds));
}

/** Seconds of one kind in every step of the logical day, split where a record crosses a step. */
function perStep(records: readonly Classified[], dayStartMs: number, stepMinutes: number, productivity: Classified["productivity"]): number[] {
  const stepMs = stepMinutes * 60_000;
  const steps = (24 * 60) / stepMinutes;
  const buckets = new Array<number>(steps).fill(0);
  for (const record of records) {
    if (record.productivity !== productivity || record.endMs <= record.startMs) continue;
    const perMs = record.seconds / (record.endMs - record.startMs);
    for (let at = record.startMs; at < record.endMs;) {
      const index = Math.floor((at - dayStartMs) / stepMs);
      const next = Math.min(record.endMs, dayStartMs + (index + 1) * stepMs);
      if (index >= 0 && index < steps) buckets[index] += (next - at) * perMs;
      at = next;
    }
  }
  return buckets;
}

/** Drift of at least a minute with focus on both sides; neutral time in between is passed over. */
function countFocusBreaks(records: readonly Classified[]): number {
  const runs: { productivity: "focus" | "drift"; seconds: number }[] = [];
  for (const record of [...records].sort((left, right) => left.startMs - right.startMs)) {
    if (record.productivity !== "focus" && record.productivity !== "drift") continue;
    const last = runs[runs.length - 1];
    if (last?.productivity === record.productivity) last.seconds += record.seconds;
    else runs.push({ productivity: record.productivity, seconds: record.seconds });
  }
  let breaks = 0;
  for (let index = 1; index < runs.length - 1; index += 1) {
    if (runs[index].productivity === "drift" && runs[index].seconds >= FOCUS_BREAK_MIN_DRIFT_SECONDS) breaks += 1;
  }
  return breaks;
}

export function buildHomeModel(input: HomeModelInput): HomeModel {
  const { today, asOfMs, startOfDayMinutes, classificationOptions } = input;
  const records = classifyAll(input.segments, classificationOptions);
  const goalIsDefault = input.goalHours === null || !(input.goalHours > 0);
  const goalSeconds = (goalIsDefault ? DEFAULT_FOCUS_GOAL_HOURS : (input.goalHours as number)) * 3600;
  const todayStart = logicalDayStartMs(today, startOfDayMinutes);
  const todayEnd = Math.min(logicalDayEndExclusiveMs(today, startOfDayMinutes), Math.max(asOfMs, todayStart));
  const offsetMs = todayEnd - todayStart;

  const todayRecords = clip(records, todayStart, todayEnd);
  const now = slice(todayRecords);
  const pattern = patternOf(todayRecords, classificationOptions);
  const deepFocusSeconds = pattern.focusRuns.filter((run) => run.seconds >= DEEP_FOCUS_MIN_SECONDS).reduce((total, run) => total + run.seconds, 0);
  const firstStartMs = todayRecords.length > 0 ? Math.min(...todayRecords.map((record) => record.startMs)) : null;

  // Usual: the same weekday in the previous BASELINE_WEEKS weeks, leaving out days off.
  const baselineSlices: HomeDaySlice[] = [];
  const baselineFull: HomeDaySlice[] = [];
  const baselineFirst: number[] = [];
  const baselineSwitches: number[] = [];
  const baselineCurves: number[][] = [];
  const baselineHours: number[][] = [];
  for (let week = 1; week <= BASELINE_WEEKS; week += 1) {
    const day = shiftIsoDate(today, -7 * week);
    const start = logicalDayStartMs(day, startOfDayMinutes);
    const full = clip(records, start, logicalDayEndExclusiveMs(day, startOfDayMinutes));
    if (full.length === 0) continue;
    const fullSlice = slice(full);
    if (fullSlice.focus < BASELINE_MIN_DAY_FOCUS_SECONDS) continue;
    const upTo = clip(full, start, start + offsetMs);
    baselineFull.push(fullSlice);
    baselineSlices.push(slice(upTo));
    baselineFirst.push((Math.min(...full.map((record) => record.startMs)) - start) / 60000);
    const switches = patternOf(upTo, classificationOptions).switches;
    if (switches) baselineSwitches.push(switches.perHour);
    baselineCurves.push(cumulativeFocus(full, start));
    baselineHours.push(perStep(full, start, 60, "focus"));
  }
  const baseline: HomeBaseline = {
    days: baselineSlices.length,
    focus: average(baselineSlices.map((entry) => entry.focus)),
    drift: average(baselineSlices.map((entry) => entry.drift)),
    fullDayFocus: average(baselineFull.map((entry) => entry.focus)),
    fullDayDrift: average(baselineFull.map((entry) => entry.drift)),
    firstStartMinutes: baselineFirst.length > 0 ? average(baselineFirst) : null,
    switchesPerHour: baselineSwitches.length > 0 ? average(baselineSwitches) : null,
  };
  const paceSeconds = baseline.days > 0 ? now.focus - baseline.focus : null;

  const yesterdayDay = shiftIsoDate(today, -1);
  const yesterdayStart = logicalDayStartMs(yesterdayDay, startOfDayMinutes);
  const yesterdayRecords = clip(records, yesterdayStart, logicalDayEndExclusiveMs(yesterdayDay, startOfDayMinutes));
  let yesterday: HomeModel["yesterday"] = null;
  if (yesterdayRecords.length > 0) {
    const yesterdayPattern = patternOf(yesterdayRecords, classificationOptions);
    const lastRun = [...yesterdayPattern.focusRuns].reverse().find((run) => run.seconds >= 15 * 60) ?? null;
    const lastItem = lastRun
      ? topItems(clip(yesterdayRecords, lastRun.startMs, lastRun.endMs + 1), "focus", workItemOf, 1)[0] ?? null
      : null;
    yesterday = {
      day: yesterdayDay,
      slice: slice(yesterdayRecords),
      topItems: topItems(yesterdayRecords, "focus", workItemOf, 3),
      lastItem,
      lastEndMs: Math.max(...yesterdayRecords.map((record) => record.endMs)),
      sessions: sessionsOf(yesterdayRecords, yesterdayPattern),
    };
  }

  const week: HomeWeekDay[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = shiftIsoDate(today, -offset);
    const start = logicalDayStartMs(day, startOfDayMinutes);
    const end = offset === 0 ? todayEnd : logicalDayEndExclusiveMs(day, startOfDayMinutes);
    const dayRecords = offset === 0 ? todayRecords : clip(records, start, end);
    const daySlice = dayRecords.length > 0 ? slice(dayRecords) : EMPTY_SLICE;
    const longest = offset === 0 ? pattern.longestFocus : (dayRecords.length > 0 ? patternOf(dayRecords, classificationOptions).longestFocus : null);
    week.push({
      day,
      focus: daySlice.focus,
      drift: daySlice.drift,
      neutral: daySlice.neutral,
      goalMet: daySlice.focus >= goalSeconds,
      longestFocus: longest ? { startMs: longest.startMs, seconds: longest.seconds } : null,
    });
  }
  const earlierRuns = week.slice(0, -1).map((entry) => entry.longestFocus?.seconds ?? 0).filter((seconds) => seconds > 0);
  const earlierLongest = Math.max(0, ...earlierRuns);
  const todayLongest = pattern.longestFocus?.seconds ?? 0;

  const topFocusItems = topItems(todayRecords, "focus", workItemOf, 3);
  return {
    today,
    asOfMs: todayEnd,
    phase: phaseAt(todayEnd, now.focus),
    goalSeconds,
    goalIsDefault,
    now,
    sources: sourcesOf(todayRecords),
    pattern,
    deepFocusSeconds,
    firstStartMs,
    firstStartMinutes: firstStartMs === null ? null : (firstStartMs - todayStart) / 60000,
    topFocusItem: topFocusItems[0] ?? null,
    topFocusItems,
    topDrift: topItems(todayRecords, "drift", siteOrApp, 1)[0] ?? null,
    topDrifts: topItems(todayRecords, "drift", siteOrApp, 5),
    lastDriftEndMs: todayRecords.filter((record) => record.productivity === "drift").reduce<number | null>((latest, record) => (latest === null || record.endMs > latest ? record.endMs : latest), null),
    baseline,
    paceSeconds,
    yesterday,
    week,
    goalMetDays: week.filter((entry) => entry.goalMet).length,
    // A record needs days to beat: at least three earlier days with focus.
    weekRecord: earlierRuns.length >= 3 && todayLongest >= 20 * 60 && todayLongest > earlierLongest,
    focusCurve: {
      startMs: todayStart,
      today: cumulativeFocus(todayRecords, todayStart),
      usual: baselineCurves.length > 0 ? baselineCurves[0].map((_, index) => average(baselineCurves.map((curve) => curve[index]))) : null,
      nowStep: Math.min(CURVE_STEPS, Math.ceil((todayEnd - todayStart) / (CURVE_STEP_MINUTES * 60_000))),
    },
    hours: hoursOf(todayRecords, todayStart, baselineHours),
    focusBreaks: countFocusBreaks(todayRecords),
    sessions: sessionsOf(todayRecords, pattern),
    lastRecordMs: todayRecords.length > 0 ? Math.max(...todayRecords.map((record) => record.endMs)) : null,
  };
}

function sessionsOf(records: readonly Classified[], pattern: DayPatternMetrics): HomeSession[] {
  const named = (kind: "focus" | "drift", run: { readonly startMs: number; readonly endMs: number; readonly seconds: number }): HomeSession => ({
    kind,
    ...run,
    item: topItems(clip(records, run.startMs, run.endMs + 1), kind, kind === "focus" ? workItemOf : siteOrApp, 1)[0] ?? null,
  });
  const driftRuns = joinProductivityRuns(records.filter((record) => record.productivity === "drift").map((record) => ({ startMs: record.startMs, endMs: record.endMs, seconds: record.seconds })));
  return [
    ...pattern.focusRuns.filter((run) => run.seconds >= SESSION_MIN_FOCUS_SECONDS).map((run) => named("focus", run)),
    ...driftRuns.filter((run) => run.seconds >= SESSION_MIN_DRIFT_SECONDS).map((run) => named("drift", run)),
  ].sort((left, right) => left.startMs - right.startMs);
}

function hoursOf(records: readonly Classified[], dayStartMs: number, usualHours: readonly (readonly number[])[]): HomeHour[] {
  const focus = perStep(records, dayStartMs, 60, "focus");
  const drift = perStep(records, dayStartMs, 60, "drift");
  const neutral = perStep(records, dayStartMs, 60, "neutral");
  return focus.map((seconds, hour) => ({
    startMs: dayStartMs + hour * 3_600_000,
    focus: seconds,
    drift: drift[hour],
    neutral: neutral[hour],
    usualFocus: usualHours.length > 0 ? average(usualHours.map((day) => day[hour])) : null,
  }));
}

export type HomeDiscovery =
  | { readonly kind: "same-hour"; readonly hour: number; readonly count: number; readonly of: number }
  | { readonly kind: "morning-heavy" | "afternoon-heavy"; readonly share: number };

/** One pattern worth saying about the last seven days, or null. */
export function weekDiscovery(model: HomeModel): HomeDiscovery | null {
  const runs = model.week.map((entry) => entry.longestFocus).filter((run): run is NonNullable<typeof run> => run !== null && run.seconds >= 20 * 60);
  if (runs.length >= 3) {
    const byHour = new Map<number, number>();
    for (const run of runs) {
      const hour = new Date(run.startMs).getHours();
      byHour.set(hour, (byHour.get(hour) ?? 0) + 1);
    }
    const [hour, count] = [...byHour.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    if (count >= 3) return { kind: "same-hour", hour, count, of: runs.length };
    const morning = runs.filter((run) => new Date(run.startMs).getHours() < 12).length;
    const share = morning / runs.length;
    if (share >= 0.75) return { kind: "morning-heavy", share };
    if (share <= 0.25) return { kind: "afternoon-heavy", share: 1 - share };
  }
  return null;
}

