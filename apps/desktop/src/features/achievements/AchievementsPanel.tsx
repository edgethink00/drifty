import { c15Layout } from "./layouts/c15";
import { useAchievementsTab, type AchievementsTabInput } from "./useAchievementsTab";

export { achievementCondition, achievementDay, achievementName, formatAchievementDay } from "./achievementCopy";
export { asEarnedForReview, initialAchievementSelection } from "./useAchievementsTab";

/** Insights › Achievements: the tabpanel, with the achievement list (layouts/c15) inside. */
export function AchievementsPanel(input: AchievementsTabInput) {
  const { Tab } = c15Layout;
  const model = useAchievementsTab(input);

  return (
    <section
      className="achievements"
      data-layout="c15"
      id="insights-tabpanel-achievements"
      role="tabpanel"
      aria-labelledby="insights-tab-achievements"
      aria-busy={model.loading ? "true" : undefined}
    >
      <Tab model={model} />
    </section>
  );
}
