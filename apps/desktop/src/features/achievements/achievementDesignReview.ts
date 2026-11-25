import { useSyncExternalStore } from "react";
import { shiftIsoDate } from "@drifty/domain";
import type { AchievementDefinition, AchievementId } from "./achievementCatalog";
import type { AchievementHistory } from "./achievementHistory";
import type { AchievementRarity } from "./achievementRarity";
import type { EarnedAchievement } from "./achievementStore";
import { CHOSEN_MEDAL_STYLE, DEFAULT_MEDAL_STYLE, parseMedalStyleKey, readMedalStyle, type MedalStyle } from "./medalStyle";

const REVIEW_STORAGE_KEY = "drifty.achievements.designReview.v19";

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

/** How much an opened row shows, in picker order. */
export const ACHIEVEMENT_OPEN_STYLES = ["full", "brief", "line", "popup", "stage"] as const;

export type AchievementOpenStyle = (typeof ACHIEVEMENT_OPEN_STYLES)[number];

/** Short labels the review page shows in its picker. */
export const ACHIEVEMENT_OPEN_STYLE_LABELS: Readonly<Record<AchievementOpenStyle, string>> = {
  full: "펼치기 1: 전체 (지금)",
  brief: "펼치기 2: 짧게, 날짜는 더 보기로",
  line: "펼치기 3: 한 줄",
  popup: "팝업 1: 메달 옆",
  stage: "팝업 2: 메달 위 크게",
};

/** What people see outside the dev review. */
export const PRODUCTION_ACHIEVEMENT_OPEN_STYLE: AchievementOpenStyle = "stage";

export function isAchievementOpenStyle(value: unknown): value is AchievementOpenStyle {
  return typeof value === "string" && (ACHIEVEMENT_OPEN_STYLES as readonly string[]).includes(value);
}

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
  /** How much of the set is drawn as earned. */
  readonly holding: AchievementReviewHolding;
  /** Offer a sort menu over the earned part (c15). */
  readonly sortMenu: boolean;
  /** How the c15 list is framed in blocks. */
  readonly frame: AchievementListFrame;
  /** The medal's design: form, palette, metal and mark. */
  readonly medal: MedalStyle;
  /** The composition being reviewed. */
  readonly layout: AchievementLayoutId;
  /** How much an opened row shows. */
  readonly open: AchievementOpenStyle;
};

function initialState(): ReviewState {
  if (!isAchievementDesignReview()) return { mockRarity: false, holding: "record", sortMenu: false, frame: PRODUCTION_ACHIEVEMENT_FRAME, medal: DEFAULT_MEDAL_STYLE, layout: PRODUCTION_ACHIEVEMENT_LAYOUT, open: PRODUCTION_ACHIEVEMENT_OPEN_STYLE };
  let saved: Partial<ReviewState> & { readonly allEarned?: boolean; readonly boxed?: boolean } = {};
  try {
    saved = JSON.parse(window.localStorage.getItem(REVIEW_STORAGE_KEY) ?? "{}") as Partial<ReviewState> & { readonly allEarned?: boolean; readonly boxed?: boolean };
  } catch {
    saved = {};
  }
  const search = new URLSearchParams(window.location.search);
  return {
    mockRarity: typeof saved.mockRarity === "boolean" ? saved.mockRarity : true,
    // ?achievementHolding=<id> wins; an older saved "all earned" choice still counts.
    holding: [search.get("achievementHolding"), saved.holding].find(isAchievementReviewHolding) ?? (saved.allEarned === true ? "all" : "record"),
    sortMenu: search.has("achievementSort") ? search.get("achievementSort") === "1" : saved.sortMenu === true,
    // ?achievementFrame=<id> wins; an older saved blocks switch still counts.
    frame: [search.get("achievementFrame"), saved.frame].find(isAchievementListFrame)
      ?? (typeof saved.boxed === "boolean" ? (saved.boxed ? "parts" : "none") : PRODUCTION_ACHIEVEMENT_FRAME),
    // ?achievementMedal=form.palette.metal.mark.art wins over the saved design; the review opens on the chosen one.
    medal: search.has("achievementMedal") ? parseMedalStyleKey(search.get("achievementMedal"), CHOSEN_MEDAL_STYLE) : readMedalStyle(saved.medal, CHOSEN_MEDAL_STYLE),
    // ?achievementLayout=<id> on the page address wins over the saved choice.
    layout: [new URLSearchParams(window.location.search).get("achievementLayout"), saved.layout].find(isAchievementLayout)
      ?? PRODUCTION_ACHIEVEMENT_LAYOUT,
    open: [new URLSearchParams(window.location.search).get("achievementOpen"), saved.open].find(isAchievementOpenStyle)
      ?? PRODUCTION_ACHIEVEMENT_OPEN_STYLE,
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

/** How much an opened row shows: the reviewed style during the dev review, else the production one. */
export function useActiveAchievementOpenStyle(): AchievementOpenStyle {
  const { open } = useAchievementReviewState();
  return isAchievementDesignReview() ? open : PRODUCTION_ACHIEVEMENT_OPEN_STYLE;
}

/**
 * How the c15 list sits in blocks, in picker order: not at all, one block for
 * each part (as the Usage tab sets its parts), a card for each achievement
 * set off by a faint fill as Search Console sets its cards, or the same cards
 * drawn with a hairline border.
 */
export const ACHIEVEMENT_LIST_FRAMES = ["none", "parts", "cards", "cardsLine"] as const;

export type AchievementListFrame = (typeof ACHIEVEMENT_LIST_FRAMES)[number];

export const ACHIEVEMENT_LIST_FRAME_LABELS: Readonly<Record<AchievementListFrame, string>> = {
  none: "상자 없음",
  parts: "묶음마다 상자",
  cards: "업적마다 상자 (채움)",
  cardsLine: "업적마다 상자 (테두리)",
};

export function isAchievementListFrame(value: unknown): value is AchievementListFrame {
  return typeof value === "string" && (ACHIEVEMENT_LIST_FRAMES as readonly string[]).includes(value);
}

/** How people see the c15 list framed. */
export const PRODUCTION_ACHIEVEMENT_FRAME: AchievementListFrame = "cards";

/** The c15 list's frame: the reviewed choice during the dev review, else the production one. */
export function useAchievementListFrame(): AchievementListFrame {
  const { frame } = useAchievementReviewState();
  return isAchievementDesignReview() ? frame : PRODUCTION_ACHIEVEMENT_FRAME;
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
