import type { DisplayLanguage } from "../../localization/languagePreference";

/**
 * Model for the Insights "Your read" surface.
 *
 * A read is one claim about one finished week. The words come from the
 * analysis model; every number on screen is recomputed here from local day
 * data, so a read can never show a figure the app did not measure.
 */

export type Localized = { readonly en: string; readonly ko: string };

export function localize(text: Localized, language: DisplayLanguage): string {
  return language === "ko" ? text.ko : text.en;
}

/** One character per 15-minute slot from the 04:00 day start: focus, drift, neutral, or idle. */
export type SlotKind = "f" | "d" | "n" | "-";
export const SLOTS_PER_DAY = 96;
export const SLOT_SECONDS = 15 * 60;
export const DAY_START_HOUR = 4;

export type ReadDay = { readonly date: string; readonly slots: string };

export type DayMetrics = {
  readonly focus: number;
  readonly drift: number;
  readonly neutral: number;
  readonly tracked: number;
  readonly firstSlot: number | null;
  readonly lastSlot: number | null;
  readonly span: number;
};

export function dayMetrics(day: ReadDay): DayMetrics {
  let focus = 0;
  let drift = 0;
  let neutral = 0;
  let firstSlot: number | null = null;
  let lastSlot: number | null = null;
  for (let index = 0; index < day.slots.length; index += 1) {
    const slot = day.slots[index];
    if (slot === "-") continue;
    if (firstSlot === null) firstSlot = index;
    lastSlot = index;
    if (slot === "f") focus += SLOT_SECONDS;
    else if (slot === "d") drift += SLOT_SECONDS;
    else neutral += SLOT_SECONDS;
  }
  const span = firstSlot === null || lastSlot === null ? 0 : (lastSlot - firstSlot + 1) * SLOT_SECONDS;
  return { focus, drift, neutral, tracked: focus + drift + neutral, firstSlot, lastSlot, span };
}

export type ReadMetricId = "focus" | "drift" | "firstActivity" | "span" | "driftShare";
export type ReadValueFormat = "duration" | "clock" | "percent";

/** Two sets of days compared on the same measures. */
export type ReadSplitEvidence = {
  readonly kind: "split";
  readonly groups: readonly [ReadGroup, ReadGroup];
  readonly metrics: readonly ReadMetricId[];
  /** Each app's average day in each group, when the read is about apps; drives the switching and time-flow views. */
  readonly apps?: readonly ReadApp[];
  /** Switches a day between two apps in each group. */
  readonly switches?: readonly ReadSwitch[];
  /**
   * The second side is an earlier stretch of time (last week, the last four
   * weeks), so it is drawn as its usual range under this week's days rather
   * than as a second set of dots.
   */
  readonly baseline?: boolean;
};

/**
 * One app on an average day of each group, computed on this device from the
 * day's segments. Only these per-group averages reach the read; no timeline.
 */
export type ReadApp = {
  readonly id: string;
  /** The app's own name; "other" collects the rest and is named by the app. */
  readonly label: string;
  /** Where the icon comes from, as in Your usage: the app's bundle for the app icon map, or a site's domain for the site icon cache. */
  readonly bundleId?: string;
  readonly siteDomain?: string;
  /** Shown in place of the icon when neither source has one. */
  readonly glyph: string;
  readonly kind: "focus" | "neutral" | "drift";
  /** Seconds on an average day of each group. */
  readonly seconds: readonly [number, number];
};

export type ReadSwitch = { readonly a: string; readonly b: string; readonly perDay: readonly [number, number] };

/**
 * This week against the user's usual for the same weekday. Your usage only
 * shows the selected window, so the baseline is what makes this a read and
 * not a redraw of the weekly chart.
 */
export type ReadShiftEvidence = {
  readonly kind: "shift";
  readonly metric: "focus" | "drift";
  /** Usual seconds for each date's weekday, averaged over prior recorded weeks. */
  readonly usual: Readonly<Record<string, number>>;
  readonly usualWeeks: number;
};

export type ReadGroup = { readonly label: Localized; readonly dates: readonly string[] };
export type ReadEvidence = ReadSplitEvidence | ReadShiftEvidence;

export type ReadCheck = { readonly verdict: "kept" | "dropped"; readonly text: Localized };

export type ReadFollowUp = {
  readonly action: Localized;
  readonly result: "improved" | "steady" | "declined" | "insufficient";
  readonly detail: Localized;
};

export type InsightsRead = {
  readonly id: string;
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly generatedOn: string;
  /** The one read written by hand right after unlock; covers the last 7 days. */
  readonly isFirst?: boolean;
  /** Recorded days (2h+) the read was allowed to use. */
  readonly comparableDays: number;
  readonly status: "read" | "abstain";
  readonly headline: Localized;
  /** The closing phrase of the headline to set apart; must appear verbatim in the headline. */
  readonly emphasis?: Localized;
  /**
   * The read's paragraph. Numbers are never written out: the model names them
   * as {fact} placeholders (see readFacts) and the app fills each one in.
   */
  readonly body: Localized;
  readonly evidence?: ReadEvidence;
  /** One sentence beside an evidence row, keyed by metric (split) or date (shift). */
  readonly notes?: Readonly<Record<string, Localized>>;
  /** The app or site the finding is about, shown only when it is the subject. */
  readonly subject?: { readonly label: string; readonly glyph: string };
  readonly tryNext?: { readonly action: Localized; readonly watch: Localized };
  readonly checked: readonly ReadCheck[];
  readonly days: readonly ReadDay[];
  readonly followUp?: ReadFollowUp;
};

export type EvidenceRow = {
  readonly id: ReadMetricId;
  readonly label: Localized;
  readonly values: readonly [number, number];
  readonly format: ReadValueFormat;
};

export const METRIC_LABELS: Record<ReadMetricId, Localized> = {
  focus: { en: "Focus", ko: "집중" },
  drift: { en: "Drift", ko: "딴짓" },
  firstActivity: { en: "First activity", ko: "첫 활동" },
  span: { en: "Day length", ko: "하루 길이" },
  driftShare: { en: "Drift share", ko: "딴짓 비율" },
};

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function groupValue(days: readonly ReadDay[], dates: readonly string[], metric: ReadMetricId): number {
  const metrics = days.filter((day) => dates.includes(day.date)).map(dayMetrics);
  switch (metric) {
    case "focus": return average(metrics.map((m) => m.focus));
    case "drift": return average(metrics.map((m) => m.drift));
    case "span": return average(metrics.map((m) => m.span));
    case "firstActivity": return average(metrics.filter((m) => m.firstSlot !== null).map((m) => m.firstSlot as number));
    case "driftShare": {
      const tracked = metrics.reduce((sum, m) => sum + m.tracked, 0);
      return tracked === 0 ? 0 : metrics.reduce((sum, m) => sum + m.drift, 0) / tracked;
    }
  }
}

export function evidenceRows(read: InsightsRead): EvidenceRow[] {
  const evidence = read.evidence;
  if (evidence?.kind !== "split") return [];
  return evidence.metrics.map((metric) => ({
    id: metric,
    label: METRIC_LABELS[metric],
    values: [
      groupValue(read.days, evidence.groups[0].dates, metric),
      groupValue(read.days, evidence.groups[1].dates, metric),
    ] as const,
    format: metric === "firstActivity" ? "clock" : metric === "driftShare" ? "percent" : "duration",
  }));
}

export type ShiftRow = { readonly date: string; readonly value: number; readonly usual: number; readonly delta: number };

/** Each day's measure this week next to its usual; recomputed here, never taken from model text. */
export function shiftRows(read: InsightsRead): ShiftRow[] {
  const evidence = read.evidence;
  if (evidence?.kind !== "shift") return [];
  return read.days.map((day) => {
    const metrics = dayMetrics(day);
    const value = evidence.metric === "focus" ? metrics.focus : metrics.drift;
    const usual = evidence.usual[day.date] ?? 0;
    return { date: day.date, value, usual, delta: value - usual };
  });
}

export function evidenceGroupLabels(read: InsightsRead): readonly [Localized, Localized] | null {
  const evidence = read.evidence;
  if (evidence?.kind !== "split") return null;
  return [evidence.groups[0].label, evidence.groups[1].label];
}

export function evidenceGroupSizes(read: InsightsRead): readonly [number, number] | null {
  const evidence = read.evidence;
  if (!evidence || evidence.kind !== "split") return null;
  return [evidence.groups[0].dates.length, evidence.groups[1].dates.length];
}

/** One day inside a split, drawn as one dot. */
export type SplitDay = { readonly date: string; readonly value: number };

/** A split row with every day's own value, so each day can be drawn as one dot. */
export type SplitRow = EvidenceRow & { readonly days: readonly [readonly SplitDay[], readonly SplitDay[]] };

function metricValueOf(metrics: DayMetrics, metric: ReadMetricId): number | null {
  switch (metric) {
    case "focus": return metrics.focus;
    case "drift": return metrics.drift;
    case "span": return metrics.span;
    case "firstActivity": return metrics.firstSlot;
    case "driftShare": return metrics.tracked === 0 ? null : metrics.drift / metrics.tracked;
  }
}

export function splitRows(read: InsightsRead): SplitRow[] {
  const evidence = read.evidence;
  if (evidence?.kind !== "split") return [];
  const valuesFor = (dates: readonly string[], metric: ReadMetricId) =>
    read.days
      .filter((day) => dates.includes(day.date))
      .map((day) => ({ date: day.date, value: metricValueOf(dayMetrics(day), metric) }))
      .filter((entry): entry is SplitDay => entry.value !== null);
  return evidenceRows(read).map((row) => ({
    ...row,
    days: [valuesFor(evidence.groups[0].dates, row.id), valuesFor(evidence.groups[1].dates, row.id)] as const,
  }));
}

export const RECORDED_DAY_SECONDS = 2 * 3600;
export const READ_REQUIRED_DAYS = 4;

/** Cumulative progress toward the one-time unlock, counted since install. */
export type ReadUnlockProgress = {
  readonly trackedSeconds: number;
  readonly meaningfulDays: number;
  /** Average classified seconds per recorded day lately; drives the unlock estimate. */
  readonly recentDailySeconds?: number;
};

export function slotClock(slot: number): string {
  const minutes = Math.round(slot * 15) + DAY_START_HOUR * 60;
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
}
