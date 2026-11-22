import { useSyncExternalStore } from "react";
import type { AchievementId } from "./achievementCatalog";
import type { AchievementRarity } from "./achievementRarity";

/** Badge art under review: the cat that came out of the review loop, beside the line marks that ship today. */
export const ACHIEVEMENT_BADGE_VARIANTS = ["cat", "line"] as const;
export type AchievementBadgeVariant = typeof ACHIEVEMENT_BADGE_VARIANTS[number];

export const ACHIEVEMENT_BADGE_VARIANT_LABELS: Record<AchievementBadgeVariant, string> = {
  cat: "고양이 (최종)",
  line: "선 아이콘 (지금)",
};

/** What ships until the review settles on one of them. */
export const PRODUCTION_BADGE_VARIANT: AchievementBadgeVariant = "line";

const REVIEW_STORAGE_KEY = "drifty.achievements.designReview.v6";

/**
 * Dev-server design review only: ?achievementReview=1 shows the art switcher,
 * example rarity figures and an everything-earned view. import.meta.env.DEV is
 * false in production builds, so the review never reaches people.
 */
export function isAchievementDesignReview(): boolean {
  return import.meta.env.DEV
    && typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("achievementReview") === "1";
}

type ReviewState = {
  readonly variant: AchievementBadgeVariant;
  readonly mockRarity: boolean;
  /** Draw every achievement as earned, to judge the whole set. */
  readonly allEarned: boolean;
};

function isVariant(value: unknown): value is AchievementBadgeVariant {
  return typeof value === "string" && (ACHIEVEMENT_BADGE_VARIANTS as readonly string[]).includes(value);
}

function initialState(): ReviewState {
  if (!isAchievementDesignReview()) return { variant: PRODUCTION_BADGE_VARIANT, mockRarity: false, allEarned: false };
  const fromUrl = new URLSearchParams(window.location.search).get("achievementBadge");
  let saved: Partial<ReviewState> = {};
  try {
    saved = JSON.parse(window.localStorage.getItem(REVIEW_STORAGE_KEY) ?? "{}") as Partial<ReviewState>;
  } catch {
    saved = {};
  }
  return {
    variant: isVariant(fromUrl) ? fromUrl : isVariant(saved.variant) ? saved.variant : "cat",
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

export function useAchievementBadgeVariant(): AchievementBadgeVariant {
  return useAchievementReviewState().variant;
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
