import { useSyncExternalStore } from "react";
import { shiftIsoDate } from "@drifty/domain";
import type { AchievementDefinition, AchievementId } from "./achievementCatalog";
import type { AchievementHistory } from "./achievementHistory";
import type { AchievementRarity } from "./achievementRarity";
import type { EarnedAchievement } from "./achievementStore";

// v21: only example holdings and rarity are reviewed now; older saved picks are dropped.
const REVIEW_STORAGE_KEY = "drifty.achievements.designReview.v21";

/**
 * How much of the set the dev review draws as earned, in picker order: the
 * example record as it is, nothing yet, a first one, a first few, or all.
 */
export const ACHIEVEMENT_REVIEW_HOLDINGS = ["record", "none", "one", "three", "all"] as const;

export type AchievementReviewHolding = (typeof ACHIEVEMENT_REVIEW_HOLDINGS)[number];

export const ACHIEVEMENT_REVIEW_HOLDING_LABELS: Readonly<Record<AchievementReviewHolding, string>> = {
  record: "예시 기록 그대로",
  none: "하나도 못 얻음",
  one: "1개 얻음",
  three: "3개 얻음",
  all: "전부 얻음",
};

export function isAchievementReviewHolding(value: unknown): value is AchievementReviewHolding {
  return typeof value === "string" && (ACHIEVEMENT_REVIEW_HOLDINGS as readonly string[]).includes(value);
}

/**
 * Design review only: achievements that just arrived, chosen by
 * ?achievementArrival=<id>, so the review can show which of them open the
 * new-achievement card. ?achievementRule=before replays the earlier rule, where
 * every new achievement opened it.
 */
export const ACHIEVEMENT_REVIEW_ARRIVALS = {
  common: { label: "흔한 업적만 새로 얻음", holding: "three", ids: ["firstFlow", "streak7", "flow90"] },
  mixed: { label: "흔한 업적과 드문 업적을 같이 얻음", holding: "all", ids: ["flow90", "noDriftDay"] },
} as const satisfies Record<string, { readonly label: string; readonly holding: AchievementReviewHolding; readonly ids: readonly AchievementId[] }>;

export type AchievementReviewArrivalId = keyof typeof ACHIEVEMENT_REVIEW_ARRIVALS;
export type AchievementReviewRule = "before" | "after";

function isArrivalId(value: unknown): value is AchievementReviewArrivalId {
  return value === "common" || value === "mixed";
}

/** What a newcomer tends to earn first, in that order, with how many times by now. */
const FIRST_EARNED: readonly (readonly [AchievementId, number])[] = [["firstFlow", 1], ["streak7", 1], ["flow90", 3]];

/** Design review only: the earned record and history of one of the first few, ending a few days before today's example. */
export function reviewFirstEarned(index: number): { readonly id: AchievementId; readonly earned: EarnedAchievement; readonly history: AchievementHistory } | null {
  const entry = FIRST_EARNED[index];
  if (!entry) return null;
  const [id, count] = entry;
  const lastDay = shiftIsoDate(REVIEW_LAST_DAY, -index * 2);
  const days = Array.from({ length: count }, (_, step) => shiftIsoDate(lastDay, -step * 4));
  return { id, earned: { firstDay: days[days.length - 1]!, lastDay, count }, history: { days, earlier: 0 } };
}

/** How many of the first few each holding keeps. */
export const REVIEW_HOLDING_COUNT: Readonly<Partial<Record<AchievementReviewHolding, number>>> = { none: 0, one: 1, three: 3 };

/**
 * Dev-server design review only: ?achievementReview=1 turns on example rarity
 * figures, example holdings (none to all earned) and card previews, driven from the
 * review page around the app (AchievementReviewBridge). import.meta.env.DEV is
 * false in production builds, so the review never reaches people.
 */
export function isAchievementDesignReview(): boolean {
  return import.meta.env.DEV
    && typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("achievementReview") === "1";
}

type ReviewState = {
  readonly mockRarity: boolean;
  /** How much of the set is drawn as earned. */
  readonly holding: AchievementReviewHolding;
  /** Achievements drawn as just arrived, or null for the stored record. */
  readonly arrival: AchievementReviewArrivalId | null;
  readonly rule: AchievementReviewRule;
  /** Arrivals already shown in this review, by the card or the tab. */
  readonly seen: readonly AchievementId[];
};

function initialState(): ReviewState {
  if (!isAchievementDesignReview()) return { mockRarity: false, holding: "record", arrival: null, rule: "after", seen: [] };
  let saved: Partial<ReviewState> = {};
  try {
    saved = JSON.parse(window.localStorage.getItem(REVIEW_STORAGE_KEY) ?? "{}") as Partial<ReviewState>;
  } catch {
    saved = {};
  }
  const search = new URLSearchParams(window.location.search);
  const arrival = search.get("achievementArrival");
  if (isArrivalId(arrival)) {
    // An arrival scenario sets its own holding and the example shares the card is judged by.
    return {
      mockRarity: true,
      holding: ACHIEVEMENT_REVIEW_ARRIVALS[arrival].holding,
      arrival,
      rule: search.get("achievementRule") === "before" ? "before" : "after",
      seen: [],
    };
  }
  return {
    mockRarity: typeof saved.mockRarity === "boolean" ? saved.mockRarity : true,
    // ?achievementHolding=<id> wins over the saved choice.
    holding: [search.get("achievementHolding"), saved.holding].find(isAchievementReviewHolding) ?? "record",
    arrival: null,
    rule: "after",
    seen: [],
  };
}

let state: ReviewState | null = null;
const listeners = new Set<() => void>();

function current(): ReviewState {
  if (!state) state = initialState();
  return state;
}

export function setAchievementReviewState(patch: Partial<ReviewState>): void {
  state = { ...current(), ...patch };
  // An arrival scenario lives in its link alone and leaves the saved choices as they were.
  if (state.arrival) {
    for (const listener of listeners) listener();
    return;
  }
  try {
    window.localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Review choice is kept for this session only.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAchievementReviewState(): ReviewState {
  return useSyncExternalStore(subscribe, current, current);
}

/** The review's arrivals not yet shown, or null outside an arrival scenario. */
export function reviewArrivalsWaiting(state: ReviewState): AchievementId[] | null {
  if (!state.arrival) return null;
  return ACHIEVEMENT_REVIEW_ARRIVALS[state.arrival].ids.filter((id) => !state.seen.includes(id));
}

/** In an arrival scenario, records arrivals as shown instead of touching the stored record; false otherwise. */
export function markReviewArrivalsSeen(ids: readonly AchievementId[]): boolean {
  const state = current();
  if (!state.arrival) return false;
  setAchievementReviewState({ seen: [...new Set([...state.seen, ...ids])] });
  return true;
}

/**
 * Example records for the everything-earned view: a spread of medal metals and
 * one long history whose oldest times are folded away. `kept` days, `every`
 * days apart, end on the last day; the rest of `count` came earlier.
 */
const REVIEW_EARNED: Readonly<Partial<Record<AchievementId, { readonly count: number; readonly kept: number; readonly every: number }>>> = {
  focusDay8h: { count: 12, kept: 12, every: 9 },
  earlyStart: { count: 57, kept: 45, every: 4 },
  nightOwl: { count: 3, kept: 3, every: 17 },
  streak30: { count: 2, kept: 2, every: 61 },
  driftDay: { count: 6, kept: 6, every: 11 },
};

const REVIEW_LAST_DAY = "2026-11-20";
/** How far before the oldest kept example day the folded-away times began. */
const REVIEW_FOLDED_SPAN_DAYS = 400;

/** Design review only: an earned record and history for an achievement drawn as earned. */
export function reviewEarnedExample(definition: AchievementDefinition): { readonly earned: EarnedAchievement; readonly history: AchievementHistory } {
  const example = definition.repeatable ? REVIEW_EARNED[definition.id] : undefined;
  if (!example) return { earned: { firstDay: REVIEW_LAST_DAY, lastDay: REVIEW_LAST_DAY, count: 1 }, history: { days: [REVIEW_LAST_DAY], earlier: 0 } };
  const days = Array.from({ length: example.kept }, (_, index) => shiftIsoDate(REVIEW_LAST_DAY, -index * example.every));
  const earlier = example.count - example.kept;
  const firstDay = earlier > 0 ? shiftIsoDate(days[days.length - 1], -REVIEW_FOLDED_SPAN_DAYS) : days[days.length - 1];
  return { earned: { firstDay, lastDay: REVIEW_LAST_DAY, count: example.count }, history: { days, earlier } };
}

/** Example figures for reviewing how rarity reads; not measured from anyone. */
export const REVIEW_RARITY: Readonly<Record<AchievementId, AchievementRarity>> = {
  firstFlow: { percent: 71, basisCount: 1240 },
  flow90: { percent: 34, basisCount: 1240 },
  flow180: { percent: 6.2, basisCount: 1240 },
  focusDay8h: { percent: 9, basisCount: 1240 },
  earlyStart: { percent: 12, basisCount: 1240 },
  nightOwl: { percent: 8, basisCount: 1240 },
  weekendShift: { percent: 15, basisCount: 1240 },
  streak7: { percent: 41, basisCount: 1240 },
  streak30: { percent: 4.1, basisCount: 1240 },
  focus100h: { percent: 18, basisCount: 1240 },
  driftDay: { percent: 2.3, basisCount: 1240 },
  noDriftDay: { percent: 0.7, basisCount: 1240 },
  comeback: { percent: 3.4, basisCount: 1240 },
};
