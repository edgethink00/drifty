import type { AchievementId } from "./achievementCatalog";
import type { AchievementDayFacts } from "./achievementFacts";

/**
 * What one day's summary says about an achievement: the figure that decided
 * it that day ("2h 4m unbroken focus"). Read-only, from the daily facts this
 * computer keeps; achievements judged over several days (streaks, the 100-hour
 * total, the comeback) have no single-day figure.
 */
export type DayMeasureKind = "run" | "focus" | "early" | "late" | "noDrift" | "drift";

const KIND: Readonly<Partial<Record<AchievementId, DayMeasureKind>>> = {
  firstFlow: "run",
  flow90: "run",
  flow180: "run",
  focusDay8h: "focus",
  earlyStart: "early",
  nightOwl: "late",
  weekendShift: "focus",
  noDriftDay: "noDrift",
  driftDay: "drift",
};

export function dayMeasureKind(id: AchievementId): DayMeasureKind | null {
  return KIND[id] ?? null;
}

/** Seconds for the time kinds, a 0–1 share for "drift". */
export function dayMeasure(kind: DayMeasureKind, facts: AchievementDayFacts): number {
  switch (kind) {
    case "run": return facts.longestFocusRunSeconds;
    case "focus": return facts.focusSeconds;
    case "early": return facts.earlyFocusSeconds;
    case "late": return facts.lateFocusSeconds;
    case "noDrift": return facts.trackedSeconds;
    case "drift": return facts.trackedSeconds > 0 ? facts.driftSeconds / facts.trackedSeconds : 0;
  }
}

/** Kinds where a best day says how close someone has come; the others are a condition met or not. */
const PROGRESS_KINDS: ReadonlySet<DayMeasureKind> = new Set(["run", "focus", "early", "late"]);

/** The kept day that came closest, for time kinds only; null when nothing counted yet. */
export function bestDay(id: AchievementId, facts: readonly AchievementDayFacts[]): { readonly day: string; readonly value: number } | null {
  const kind = dayMeasureKind(id);
  if (!kind || !PROGRESS_KINDS.has(kind)) return null;
  let best: { day: string; value: number } | null = null;
  for (const entry of facts) {
    const value = dayMeasure(kind, entry);
    if (value > 0 && (!best || value > best.value)) best = { day: entry.day, value };
  }
  return best;
}
