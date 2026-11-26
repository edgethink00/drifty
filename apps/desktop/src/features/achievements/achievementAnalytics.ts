import { capturePostHogDailyEvent, capturePostHogEvent } from "../../lib/analytics/posthogClient";
import type { PostHogEventPropertiesByName } from "../../lib/analytics/eventTypes";
import type { AchievementId } from "./achievementCatalog";
import { orderNewAchievements } from "./achievementAnnouncement";
import { isAchievementDesignReview } from "./achievementDesignReview";
import type { AchievementItem } from "./useAchievements";

/**
 * Product analytics for achievements (Usage statistics on). Only what happened
 * is sent: never which achievement, so holdings stay off analytics as the
 * privacy policy promises. The card adds its kind and a coarse rarity band.
 */
type AchievementAction = PostHogEventPropertiesByName["achievement_action"];
export type AchievementRarityBand = NonNullable<AchievementAction["rarity_band"]>;
export type AchievementCardAnalytics = Required<Pick<AchievementAction, "card_kind" | "rarity_band">>;

export function achievementRarityBand(percent: number | null | undefined): AchievementRarityBand {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return "unknown";
  if (percent < 1) return "under_1";
  if (percent < 10) return "under_10";
  if (percent <= 30) return "under_30";
  return "over_30";
}

/** The card's kind and the band of the achievement leading it, as the card shows them. */
export function achievementCardAnalytics(
  items: readonly AchievementItem[],
  ids: readonly AchievementId[],
  firstLook: boolean,
): AchievementCardAnalytics {
  const shown = orderNewAchievements(items.filter((item) => item.earned && ids.includes(item.definition.id)));
  return {
    card_kind: firstLook && shown.length > 1 ? "first_look" : "single",
    rarity_band: achievementRarityBand(shown[0]?.rarity?.percent),
  };
}

/** The dev design review plays scenarios; none of it is a person's use. */
function counted(): boolean {
  return !isAchievementDesignReview();
}

/** The app opens the card itself, so its showing counts once a day; closing it or going to the tab is the person's choice. */
export function reportAchievementCard(action: "card_shown" | "card_opened_tab" | "card_closed", card: AchievementCardAnalytics): void {
  if (!counted()) return;
  if (action === "card_shown") {
    capturePostHogDailyEvent("achievement_action", `card_shown:${card.card_kind}:${card.rarity_band}`, { action, ...card });
    return;
  }
  capturePostHogEvent("achievement_action", { action, ...card });
}

/** Reach, not frequency: whether the tab and an achievement's details were opened that day. */
export function reportAchievementsTabOpened(): void {
  if (counted()) capturePostHogDailyEvent("achievement_action", "tab_opened", { action: "tab_opened" });
}

export function reportAchievementDetailOpened(): void {
  if (counted()) capturePostHogDailyEvent("achievement_action", "detail_opened", { action: "detail_opened" });
}
