import type { AchievementGroup, AchievementId } from "./achievementCatalog";

export type AchievementArtState = "earned" | "locked" | "concealed";

export type AchievementArtProps = {
  readonly id: AchievementId;
  readonly group: AchievementGroup;
  readonly state: AchievementArtState;
  /** False at the smallest size, where fine detail would only blur. */
  readonly detail: boolean;
  /** Milestones reached so far (1, 5, 10, 25, 50, 100), 0 until earned. */
  readonly tier: number;
};
