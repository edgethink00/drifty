import { useSyncExternalStore } from "react";
import { shiftIsoDate } from "@drifty/domain";
import type { AchievementDefinition, AchievementId } from "./achievementCatalog";
import type { AchievementHistory } from "./achievementHistory";
import type { AchievementRarity } from "./achievementRarity";
import type { EarnedAchievement } from "./achievementStore";

const REVIEW_STORAGE_KEY = "drifty.achievements.designReview.v16";

/** Compositions of the achievements screens the dev review can switch between, in picker order. */
export const ACHIEVEMENT_LAYOUTS = ["c12", "c13", "c14", "c15", "c16"] as const;

export type AchievementLayoutId = (typeof ACHIEVEMENT_LAYOUTS)[number];

/** Short labels the review page shows in its layout picker. */
export const ACHIEVEMENT_LAYOUT_LABELS: Readonly<Record<AchievementLayoutId, string>> = {
  c12: "구성 12: 한 줄 원장",
  c13: "구성 13: 두 줄 읽기 폭",
  c14: "구성 14: 기록 띠 줄",
  c15: "구성 15: 큰 메달 목록",
  c16: "구성 16: 조용한 체크리스트",
};

/** The composition people see outside the dev review. */
export const PRODUCTION_ACHIEVEMENT_LAYOUT: AchievementLayoutId = "c15";

export function isAchievementLayout(value: unknown): value is AchievementLayoutId {
  return typeof value === "string" && (ACHIEVEMENT_LAYOUTS as readonly string[]).includes(value);
}

/**
 * Dev-server design review only: ?achievementReview=1 turns on example rarity
 * figures, an everything-earned view and card previews, driven from the
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
  /** Draw every achievement as earned, to judge the whole set. */
  readonly allEarned: boolean;
  /** The composition being reviewed. */
  readonly layout: AchievementLayoutId;
};

function initialState(): ReviewState {
  if (!isAchievementDesignReview()) return { mockRarity: false, allEarned: false, layout: PRODUCTION_ACHIEVEMENT_LAYOUT };
  let saved: Partial<ReviewState> = {};
  try {
    saved = JSON.parse(window.localStorage.getItem(REVIEW_STORAGE_KEY) ?? "{}") as Partial<ReviewState>;
  } catch {
    saved = {};
  }
  return {
    mockRarity: typeof saved.mockRarity === "boolean" ? saved.mockRarity : true,
    allEarned: saved.allEarned === true,
    // ?achievementLayout=<id> on the page address wins over the saved choice.
    layout: [new URLSearchParams(window.location.search).get("achievementLayout"), saved.layout].find(isAchievementLayout)
      ?? PRODUCTION_ACHIEVEMENT_LAYOUT,
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

/** The composition to draw: the reviewed one during the dev review, else the production one. */
export function useActiveAchievementLayout(): AchievementLayoutId {
  const { layout } = useAchievementReviewState();
  return isAchievementDesignReview() ? layout : PRODUCTION_ACHIEVEMENT_LAYOUT;
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
