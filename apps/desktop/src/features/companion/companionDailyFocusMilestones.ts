import type { CompanionPillMilestoneEvent } from "./CompanionPillMoment";
import type { TranslationKey } from "../localization/translations";
import { translateFor, type Translate } from "../localization/translate";

export const COMPANION_DAILY_FOCUS_MILESTONES_STORAGE_KEY =
  "drifty.companion.dailyFocusMilestones.v1";

/**
 * Whether a resident surface may treat today's focus figure as live progress.
 *
 * The evaluated day comes from the wall clock and flips the instant the logical
 * day rolls over, while the loaded segments only catch up when the follow-up
 * refresh lands. In that window the figure still describes the previous day, and
 * a milestone would celebrate yesterday's focus under today's date. The same
 * mismatch appears on launch, before the first day's segments have arrived.
 *
 * Which source backs the figure depends on what the user is looking at. While
 * today is selected it comes from the dashboard's `segments`, so
 * `segmentsLoadedDay` must name the evaluated day. Browsing an earlier day
 * switches the snapshot to the drift-alarm base segments, which are only ever
 * written for the current alarm day and reset on rollover — that source stays
 * pinned to today, so milestones keep working while the user reads history.
 */
export function canEvaluateCompanionDailyFocus({
  loaded,
  blocked,
  viewingToday,
  segmentsLoadedDay,
  day,
}: {
  readonly loaded: boolean;
  readonly blocked: boolean;
  /** True when the dashboard's selected day is the evaluated day. */
  readonly viewingToday: boolean;
  readonly segmentsLoadedDay: string | null;
  readonly day: string;
}): boolean {
  if (!loaded || blocked) return false;
  /* Reading history does not pause the day's own progress; that snapshot is
     built from the today-pinned alarm segments rather than the browsed day. */
  if (!viewingToday) return true;
  return segmentsLoadedDay === day;
}

export type CompanionDailyFocusMilestoneId = "day3h" | "day5h" | "day8h";

export type CompanionDailyFocusMilestoneProgress = {
  readonly day: string;
  readonly observedFocusSeconds: number;
  readonly celebrated: readonly CompanionDailyFocusMilestoneId[];
};

type StoredCompanionDailyFocusMilestoneProgress = {
  readonly day: string;
  readonly celebrated: readonly CompanionDailyFocusMilestoneId[];
};

type DailyFocusMilestoneDefinition = {
  readonly id: CompanionDailyFocusMilestoneId;
  readonly thresholdSeconds: number;
  readonly titleKey: TranslationKey;
  readonly subtitleKey: TranslationKey;
  readonly tier: 1 | 2;
};

export const COMPANION_DAILY_FOCUS_MILESTONES: readonly DailyFocusMilestoneDefinition[] = [
  {
    id: "day3h",
    thresholdSeconds: 3 * 60 * 60,
    titleKey: "companion.milestone.day3hTitle",
    subtitleKey: "companion.milestone.day3hSubtitle",
    tier: 1,
  },
  {
    id: "day5h",
    thresholdSeconds: 5 * 60 * 60,
    titleKey: "companion.milestone.day5hTitle",
    subtitleKey: "companion.milestone.day5hSubtitle",
    tier: 1,
  },
  {
    id: "day8h",
    thresholdSeconds: 8 * 60 * 60,
    titleKey: "companion.milestone.day8hTitle",
    subtitleKey: "companion.milestone.day8hSubtitle",
    tier: 2,
  },
];

export type CompanionDailyFocusMilestoneEvaluation = {
  readonly progress: CompanionDailyFocusMilestoneProgress;
  readonly events: readonly CompanionPillMilestoneEvent[];
};

/**
 * Establish the live-session baseline without replaying achievements that
 * happened while Drifty or the Companion was unavailable. A resident surface
 * should acknowledge the work happening now, not dump stale celebrations when
 * it returns after sleep, an app restart, or a deliberate temporary hide.
 */
export function initializeCompanionDailyFocusMilestones(
  day: string,
  focusSecondsToday: number,
  stored: StoredCompanionDailyFocusMilestoneProgress | null = readCompanionDailyFocusMilestones(),
): CompanionDailyFocusMilestoneProgress {
  const normalizedSeconds = normalizeFocusSeconds(focusSecondsToday);
  const celebrated = new Set<CompanionDailyFocusMilestoneId>(
    stored?.day === day ? stored.celebrated : [],
  );

  for (const milestone of COMPANION_DAILY_FOCUS_MILESTONES) {
    if (normalizedSeconds >= milestone.thresholdSeconds) celebrated.add(milestone.id);
  }

  return {
    day,
    observedFocusSeconds: normalizedSeconds,
    celebrated: orderedMilestoneIds(celebrated),
  };
}

/** Advance the current logical day and return every newly crossed rung. */
export function evaluateCompanionDailyFocusMilestones({
  progress,
  day,
  focusSecondsToday,
  announce,
  translate = translateFor("en"),
}: {
  readonly progress: CompanionDailyFocusMilestoneProgress;
  readonly day: string;
  readonly focusSecondsToday: number;
  readonly announce: boolean;
  /** Builds the card wording in the display language; events cross to the Companion window as strings. */
  readonly translate?: Translate;
}): CompanionDailyFocusMilestoneEvaluation {
  if (progress.day !== day) {
    return {
      progress: initializeCompanionDailyFocusMilestones(day, focusSecondsToday, null),
      events: [],
    };
  }

  const normalizedSeconds = normalizeFocusSeconds(focusSecondsToday);
  const celebrated = new Set(progress.celebrated);
  const crossed: DailyFocusMilestoneDefinition[] = [];

  for (const milestone of COMPANION_DAILY_FOCUS_MILESTONES) {
    if (celebrated.has(milestone.id) || normalizedSeconds < milestone.thresholdSeconds) continue;
    celebrated.add(milestone.id);
    if (progress.observedFocusSeconds < milestone.thresholdSeconds) crossed.push(milestone);
  }

  return {
    progress: {
      day,
      observedFocusSeconds: normalizedSeconds,
      celebrated: orderedMilestoneIds(celebrated),
    },
    events: announce
      ? crossed.map((milestone) => buildDailyFocusMilestoneEvent(milestone, day, normalizedSeconds, translate))
      : [],
  };
}

export function readCompanionDailyFocusMilestones(): StoredCompanionDailyFocusMilestoneProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(COMPANION_DAILY_FOCUS_MILESTONES_STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isStoredProgress(value)) return null;
    return value;
  } catch {
    return null;
  }
}

export function persistCompanionDailyFocusMilestones(
  progress: CompanionDailyFocusMilestoneProgress,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      COMPANION_DAILY_FOCUS_MILESTONES_STORAGE_KEY,
      JSON.stringify({ day: progress.day, celebrated: progress.celebrated }),
    );
  } catch {
    // The in-memory session still prevents duplicates if storage is unavailable.
  }
}

function buildDailyFocusMilestoneEvent(
  milestone: DailyFocusMilestoneDefinition,
  day: string,
  focusSecondsToday: number,
  translate: Translate,
): CompanionPillMilestoneEvent {
  return {
    kind: "milestone",
    id: `companion-daily-focus:${day}:${milestone.id}`,
    milestoneKind: "total",
    tier: milestone.tier,
    title: translate(milestone.titleKey),
    subtitle: translate(milestone.subtitleKey),
    destination: "dashboard",
    statSeconds: focusSecondsToday,
    generatedAt: new Date().toISOString(),
  };
}

function orderedMilestoneIds(
  values: ReadonlySet<CompanionDailyFocusMilestoneId>,
): CompanionDailyFocusMilestoneId[] {
  return COMPANION_DAILY_FOCUS_MILESTONES
    .map((milestone) => milestone.id)
    .filter((id) => values.has(id));
}

function normalizeFocusSeconds(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function isStoredProgress(value: unknown): value is StoredCompanionDailyFocusMilestoneProgress {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { day?: unknown; celebrated?: unknown };
  return typeof candidate.day === "string"
    && Array.isArray(candidate.celebrated)
    && candidate.celebrated.every(isDailyFocusMilestoneId);
}

function isDailyFocusMilestoneId(value: unknown): value is CompanionDailyFocusMilestoneId {
  return value === "day3h" || value === "day5h" || value === "day8h";
}
