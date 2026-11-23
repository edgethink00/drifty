import { useActiveAchievementLayout, type AchievementLayoutId } from "./achievementDesignReview";
import { ACHIEVEMENT_LAYOUT_REGISTRY } from "./layouts/registry";
import { useAchievementsTab, type AchievementsTabInput } from "./useAchievementsTab";

export { achievementCondition, achievementDay, achievementName, formatAchievementDay } from "./achievementCopy";
export { closestAchievements, nextMedal } from "./achievementProgress";
export { asEarnedForReview, initialAchievementSelection } from "./useAchievementsTab";

type AchievementsPanelProps = AchievementsTabInput & {
  /** Draw this composition instead of the active one. */
  readonly layout?: AchievementLayoutId;
};

/** Insights › Achievements: the tabpanel every layout shares, with the layout's tab inside. */
export function AchievementsPanel({ layout, ...input }: AchievementsPanelProps) {
  const active = useActiveAchievementLayout();
  const id = layout ?? active;
  const { Tab, tabLayout } = ACHIEVEMENT_LAYOUT_REGISTRY[id];
  const model = useAchievementsTab(input);

  return (
    <section
      className="achievements"
      data-layout={tabLayout ?? id}
      id="insights-tabpanel-achievements"
      role="tabpanel"
      aria-labelledby="insights-tab-achievements"
      aria-busy={model.loading ? "true" : undefined}
    >
      <Tab model={model} />
    </section>
  );
}
