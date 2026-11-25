import type { DisplayLanguage } from "../localization/languagePreference";
import { localeForDisplayLanguage } from "../../lib/formatting";
import type { AchievementDefinition } from "./achievementCatalog";

/** Share of counted Drifty installs that have earned an achievement (achievementRaritySource.ts); the UI shows it only when present. */
export type AchievementRarity = {
  readonly percent: number;
  /** People the share is taken over. */
  readonly basisCount: number;
};

export type AchievementTier = 1 | 2 | 3 | 4 | 5;

export const ACHIEVEMENT_TIERS: readonly AchievementTier[] = [1, 2, 3, 4, 5];

/** Common → legendary by how few people have the achievement. */
export function rarityTier(percent: number): AchievementTier {
  if (percent >= 40) return 1;
  if (percent >= 15) return 2;
  if (percent >= 5) return 3;
  if (percent >= 1) return 4;
  return 5;
}

/** Before rarity exists, the catalogue's own sense of difficulty picks the tier. */
export function difficultyTier(definition: AchievementDefinition): AchievementTier {
  if (definition.weight >= 6) return 4;
  if (definition.weight >= 5) return 3;
  if (definition.weight >= 3) return 2;
  return 1;
}

export function achievementTier(definition: AchievementDefinition, rarity: AchievementRarity | null): AchievementTier {
  return rarity ? rarityTier(rarity.percent) : difficultyTier(definition);
}

export function formatRarityPercent(percent: number, language: DisplayLanguage): string {
  return new Intl.NumberFormat(localeForDisplayLanguage(language), { maximumFractionDigits: percent < 10 ? 1 : 0 }).format(percent);
}

export function formatRarityBasis(count: number, language: DisplayLanguage): string {
  return new Intl.NumberFormat(localeForDisplayLanguage(language)).format(count);
}

