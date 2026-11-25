import type { AchievementId } from "./achievementCatalog";
import type { AchievementItem } from "./useAchievements";

/**
 * A newly earned achievement gets the new-achievement card only when at most
 * this share of Drifty users holds it (owner decision 2026-11-26). Commoner
 * ones arrive quietly: Insights marks its Achievements tab and their rows new.
 */
export const CARD_AT_MOST_PERCENT = 30;

/** What the new-achievement card shows, and whether it is the first look back. */
export type AchievementAnnouncement = {
  readonly ids: readonly AchievementId[];
  readonly firstLook: boolean;
};

/**
 * Which new achievements open the card, or null when none should.
 * The first look back still summarises everything the first check found.
 * Otherwise only the rarest card-worthy one leads; the rest stay new in
 * Insights and may get their own card on a later day.
 */
export function achievementAnnouncement(
  items: readonly AchievementItem[],
  unannounced: readonly AchievementId[],
  firstLookPending: boolean,
): AchievementAnnouncement | null {
  const waiting = new Set(unannounced);
  const fresh = items.filter((item) => item.earned !== null && waiting.has(item.definition.id));
  if (firstLookPending && fresh.length > 1) return { ids: fresh.map((item) => item.definition.id), firstLook: true };
  const lead = fresh
    .filter((item) => item.rarity !== null && item.rarity.percent <= CARD_AT_MOST_PERCENT)
    .sort((left, right) => left.rarity!.percent - right.rarity!.percent || right.definition.weight - left.definition.weight)[0];
  return lead ? { ids: [lead.definition.id], firstLook: false } : null;
}
