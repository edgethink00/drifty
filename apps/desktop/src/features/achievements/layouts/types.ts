import type { ComponentType } from "react";
import type { AchievementsTabModel } from "../useAchievementsTab";
import type { AchievementItem } from "../useAchievements";

/**
 * A layout's tab. AchievementsPanel already renders the tabpanel section
 * (`.achievements[data-layout=<id>]`) and runs the shared behaviour; the tab
 * draws inside it from the model.
 */
export type AchievementLayoutTabProps = {
  readonly model: AchievementsTabModel;
};

/**
 * A layout's new-achievement card body. AchievementUnlockDialog owns the shell
 * (`.achievement-unlock[data-layout=<id>]`, overlay, Escape, close button);
 * the card draws everything after the close button, its actions included.
 */
export type AchievementLayoutCardProps = {
  /** New achievements, most notable first. */
  readonly ordered: readonly AchievementItem[];
  /** ordered[0], the one the card leads with. */
  readonly lead: AchievementItem;
  /** ordered without the lead. */
  readonly others: readonly AchievementItem[];
  /** The first look back found these together (and there are several). */
  readonly showFirstLook: boolean;
  /** Give the card's title heading this id: the dialog is labelled by it. */
  readonly titleId: string;
  readonly onClose: () => void;
  readonly onView: () => void;
};

export type AchievementLayout = {
  readonly Tab: ComponentType<AchievementLayoutTabProps>;
  readonly Card: ComponentType<AchievementLayoutCardProps>;
  /** The shared modal-shell size; compact unless the card needs more room. */
  readonly dialogVariant?: "compact" | "standard" | "workspace" | "expressive";
};
