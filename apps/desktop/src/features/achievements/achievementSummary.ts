import type { Translate } from "../localization/translate";
import type { TranslationKey } from "../localization/translations";
import { achievementHoldings, type HeldMedal } from "./achievementCollection";
import type { AchievementItem } from "./useAchievements";

const MEDAL_KEYS: Readonly<Record<HeldMedal, TranslationKey>> = {
  silver: "achievements.medal.silver",
  gold: "achievements.medal.gold",
  ring: "achievements.medal.ringShort",
};

/** Richest metal first: "gold 3 · silver 4". */
const MEDALS_SHOWN: readonly HeldMedal[] = ["ring", "gold", "silver"];

export type AchievementSummaryPart = {
  readonly key: string;
  readonly name: string;
  readonly count: number;
};

/**
 * The summary line: how many achievements are held, then the same count by
 * rarity tier (common first) when every held one has a rarity, else by medal
 * metal. Never "N of 13": the catalogue size is not a goal, and it would give
 * away that hidden achievements exist. Parts held zero times are left out.
 */
export type AchievementSummary = {
  readonly heldCount: number;
  /** "7 achievements", or a quiet line when nothing is held yet. */
  readonly held: string;
  readonly kind: "rarity" | "medal" | null;
  /** Read before the parts by screen readers: "Held by rarity:". */
  readonly partsLabel: string | null;
  readonly parts: readonly AchievementSummaryPart[];
  /** The whole line as plain text: "7 achievements · Common 2 · Rare 1". */
  readonly text: string;
};

export function achievementSummary(items: readonly AchievementItem[], t: Translate): AchievementSummary {
  const holdings = achievementHoldings(items);
  const heldCount = holdings?.total ?? 0;
  const held = heldCount === 0 ? t("achievements.heldNone")
    : heldCount === 1 ? t("achievements.heldOne")
      : t("achievements.held", { count: heldCount });
  const parts: AchievementSummaryPart[] = !holdings ? []
    : holdings.kind === "rarity"
      ? holdings.tiers.map(({ tier, count }) => ({ key: "tier-" + tier, name: t(("achievements.tier." + tier) as TranslationKey), count }))
      : MEDALS_SHOWN.map((medal) => ({ key: medal, name: t(MEDAL_KEYS[medal]), count: holdings.medals.find((entry) => entry.medal === medal)?.count ?? 0 }));
  const shown = parts.filter(({ count }) => count > 0);
  return {
    heldCount,
    held,
    kind: holdings?.kind ?? null,
    partsLabel: holdings ? t(holdings.kind === "rarity" ? "achievements.held.byRarity" : "achievements.held.byMedal") : null,
    parts: shown,
    text: [held, ...shown.map(({ name, count }) => name + " " + count)].join(" · "),
  };
}
