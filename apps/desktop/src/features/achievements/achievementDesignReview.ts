import { useSyncExternalStore } from "react";
import type { AchievementId } from "./achievementCatalog";
import type { AchievementRarity } from "./achievementRarity";

const REVIEW_STORAGE_KEY = "drifty.achievements.designReview.v14";

/**
 * Dev-server design review only: ?achievementReview=1 shows example rarity
 * figures, an everything-earned view and previews of the cards.
 * import.meta.env.DEV is false in production builds, so the review never
 * reaches people.
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
};

function initialState(): ReviewState {
  if (!isAchievementDesignReview()) return { mockRarity: false, allEarned: false };
  let saved: Partial<ReviewState> = {};
  try {
    saved = JSON.parse(window.localStorage.getItem(REVIEW_STORAGE_KEY) ?? "{}") as Partial<ReviewState>;
  } catch {
    saved = {};
  }
  return {
    mockRarity: typeof saved.mockRarity === "boolean" ? saved.mockRarity : true,
    allEarned: saved.allEarned === true,
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
