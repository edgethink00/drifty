import { shiftIsoDate } from "@drifty/domain";
import type { AchievementDayFacts } from "./achievementFacts";
import {
  ACHIEVEMENT_IDS,
  achievementDefinition,
  evaluateAchievements,
  type AchievementEvaluation,
  type AchievementId,
} from "./achievementCatalog";

/** Device-local: summaries and earned achievements never leave this computer. */
export const ACHIEVEMENT_STORE_KEY = "drifty.achievements.v1";

/** Days summarised one by one; older days fold into a running focus total. */
export const ACHIEVEMENT_KEPT_DAYS = 730;
/** First look-back when no summary exists yet. */
export const ACHIEVEMENT_BACKFILL_DAYS = 365;
/** Recent days summarised again on each check so classification fixes still count. */
export const ACHIEVEMENT_REFRESH_DAYS = 14;

/** [tracked, focus, drift, longest focus run, early focus, late focus] in seconds, then the day's shape when known. */
type CompactFacts =
  | readonly [number, number, number, number, number, number]
  | readonly [number, number, number, number, number, number, string];

const SHAPE_PATTERN = /^[fnd.]{96}$/u;

export type EarnedAchievement = {
  readonly firstDay: string;
  readonly lastDay: string;
  readonly count: number;
};

export type AchievementStore = {
  readonly version: 1;
  readonly facts: Readonly<Record<string, CompactFacts>>;
  readonly archivedFocusSeconds: number;
  readonly evaluatedThroughDay: string | null;
  readonly earned: Readonly<Partial<Record<AchievementId, EarnedAchievement>>>;
  /** Achievements the person has already been shown, in the new-achievement card or the tab. */
  readonly announced: readonly AchievementId[];
  /** True until the achievements found in the first look-back have been shown together. */
  readonly firstLookPending: boolean;
};

export const EMPTY_ACHIEVEMENT_STORE: AchievementStore = {
  version: 1,
  facts: {},
  archivedFocusSeconds: 0,
  evaluatedThroughDay: null,
  earned: {},
  announced: [],
  firstLookPending: true,
};

export function readAchievementStore(storage: Storage | null = safeLocalStorage()): AchievementStore {
  if (!storage) return EMPTY_ACHIEVEMENT_STORE;
  try {
    const raw = storage.getItem(ACHIEVEMENT_STORE_KEY);
    return raw ? parseAchievementStore(JSON.parse(raw)) : EMPTY_ACHIEVEMENT_STORE;
  } catch {
    return EMPTY_ACHIEVEMENT_STORE;
  }
}

export function writeAchievementStore(store: AchievementStore, storage: Storage | null = safeLocalStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(ACHIEVEMENT_STORE_KEY, JSON.stringify(store));
  } catch {
    // The in-memory store still serves this session.
  }
}

/** The days to summarise next, ending with yesterday; null when nothing is due. */
export function nextAchievementRange(store: AchievementStore, yesterday: string): { startDay: string; endDay: string } | null {
  const earliest = shiftIsoDate(yesterday, -(ACHIEVEMENT_BACKFILL_DAYS - 1));
  if (store.evaluatedThroughDay === null) return { startDay: earliest, endDay: yesterday };
  if (store.evaluatedThroughDay >= yesterday) return null;
  const refreshFrom = shiftIsoDate(yesterday, -(ACHIEVEMENT_REFRESH_DAYS - 1));
  const afterLast = shiftIsoDate(store.evaluatedThroughDay, 1);
  const startDay = afterLast < refreshFrom ? afterLast : refreshFrom;
  return { startDay: startDay < earliest ? earliest : startDay, endDay: yesterday };
}

/**
 * Replace the summaries for startDay..endDay with fresh ones and re-evaluate.
 * Earned achievements are kept even when a later correction would no longer
 * reach them: something the person has been told they earned is not taken back.
 */
export function mergeAchievementFacts(
  store: AchievementStore,
  facts: readonly AchievementDayFacts[],
  range: { readonly startDay: string; readonly endDay: string },
): AchievementStore {
  const nextFacts: Record<string, CompactFacts> = {};
  for (const [day, value] of Object.entries(store.facts)) {
    if (day < range.startDay || day > range.endDay) nextFacts[day] = value;
  }
  for (const day of facts) {
    if (day.day < range.startDay || day.day > range.endDay) continue;
    const numbers = [day.trackedSeconds, day.focusSeconds, day.driftSeconds, day.longestFocusRunSeconds, day.earlyFocusSeconds, day.lateFocusSeconds] as const;
    nextFacts[day.day] = day.shape && SHAPE_PATTERN.test(day.shape) ? [...numbers, day.shape] : numbers;
  }
  const keepFrom = shiftIsoDate(range.endDay, -(ACHIEVEMENT_KEPT_DAYS - 1));
  let archivedFocusSeconds = store.archivedFocusSeconds;
  for (const [day, value] of Object.entries(nextFacts)) {
    if (day >= keepFrom) continue;
    archivedFocusSeconds += value[1];
    delete nextFacts[day];
  }
  const evaluatedThroughDay = store.evaluatedThroughDay !== null && store.evaluatedThroughDay > range.endDay
    ? store.evaluatedThroughDay
    : range.endDay;
  const next: AchievementStore = { ...store, facts: nextFacts, archivedFocusSeconds, evaluatedThroughDay };
  const earned = mergeEarned(store.earned, evaluateAchievements(storedFacts(next), { archivedFocusSeconds }));
  // The first look shows what it found together; with nothing found, later
  // achievements arrive one at a time.
  const firstLookPending = store.evaluatedThroughDay === null ? Object.keys(earned).length > 0 && store.firstLookPending : store.firstLookPending;
  return { ...next, earned, firstLookPending };
}

/**
 * After history is deleted, forget the summaries and everything earned from
 * them; the next check summarises what remains. What was already shown stays
 * shown, so re-earning from kept history does not announce it again.
 */
export function forgetAchievementHistory(store: AchievementStore): AchievementStore {
  return { ...EMPTY_ACHIEVEMENT_STORE, announced: store.announced, firstLookPending: false };
}

export function markAchievementsAnnounced(store: AchievementStore, ids: readonly AchievementId[]): AchievementStore {
  const announced = new Set(store.announced);
  for (const id of ids) announced.add(id);
  return { ...store, announced: ACHIEVEMENT_IDS.filter((id) => announced.has(id)), firstLookPending: false };
}

export function unannouncedAchievements(store: AchievementStore): AchievementId[] {
  const announced = new Set(store.announced);
  return ACHIEVEMENT_IDS.filter((id) => store.earned[id] && !announced.has(id));
}

export function storedFacts(store: AchievementStore): AchievementDayFacts[] {
  return Object.entries(store.facts)
    .map(([day, value]) => ({
      day,
      trackedSeconds: value[0],
      focusSeconds: value[1],
      driftSeconds: value[2],
      longestFocusRunSeconds: value[3],
      earlyFocusSeconds: value[4],
      lateFocusSeconds: value[5],
      ...(value.length === 7 ? { shape: value[6] } : {}),
    }))
    .sort((left, right) => left.day.localeCompare(right.day));
}

export function evaluateStoredAchievements(store: AchievementStore): AchievementEvaluation[] {
  return evaluateAchievements(storedFacts(store), { archivedFocusSeconds: store.archivedFocusSeconds });
}

function mergeEarned(
  previous: AchievementStore["earned"],
  evaluations: readonly AchievementEvaluation[],
): AchievementStore["earned"] {
  const next: Partial<Record<AchievementId, EarnedAchievement>> = { ...previous };
  for (const evaluation of evaluations) {
    const days = evaluation.earnedDays;
    if (days.length === 0) continue;
    const before = previous[evaluation.id];
    const firstDay = before && before.firstDay < days[0] ? before.firstDay : days[0];
    const lastDay = before && before.lastDay > days[days.length - 1] ? before.lastDay : days[days.length - 1];
    const count = achievementDefinition(evaluation.id).repeatable ? Math.max(before?.count ?? 0, days.length) : 1;
    next[evaluation.id] = { firstDay, lastDay, count };
  }
  return next;
}

function parseAchievementStore(value: unknown): AchievementStore {
  if (!value || typeof value !== "object") return EMPTY_ACHIEVEMENT_STORE;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return EMPTY_ACHIEVEMENT_STORE;
  const facts: Record<string, CompactFacts> = {};
  if (record.facts && typeof record.facts === "object") {
    for (const [day, entry] of Object.entries(record.facts as Record<string, unknown>)) {
      if (!isIsoDay(day) || !Array.isArray(entry) || (entry.length !== 6 && entry.length !== 7)) continue;
      if (!entry.slice(0, 6).every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0)) continue;
      if (entry.length === 7 && !(typeof entry[6] === "string" && SHAPE_PATTERN.test(entry[6]))) continue;
      facts[day] = entry as unknown as CompactFacts;
    }
  }
  const earned: Partial<Record<AchievementId, EarnedAchievement>> = {};
  if (record.earned && typeof record.earned === "object") {
    for (const id of ACHIEVEMENT_IDS) {
      const entry = (record.earned as Record<string, unknown>)[id];
      if (!entry || typeof entry !== "object") continue;
      const { firstDay, lastDay, count } = entry as Record<string, unknown>;
      if (isIsoDay(firstDay) && isIsoDay(lastDay) && typeof count === "number" && count >= 1) earned[id] = { firstDay, lastDay, count: Math.floor(count) };
    }
  }
  const announcedRaw = Array.isArray(record.announced) ? record.announced : [];
  return {
    version: 1,
    facts,
    archivedFocusSeconds: typeof record.archivedFocusSeconds === "number" && record.archivedFocusSeconds >= 0 ? record.archivedFocusSeconds : 0,
    evaluatedThroughDay: isIsoDay(record.evaluatedThroughDay) ? record.evaluatedThroughDay : null,
    earned,
    announced: ACHIEVEMENT_IDS.filter((id) => announcedRaw.includes(id)),
    firstLookPending: record.firstLookPending === true,
  };
}

function isIsoDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

