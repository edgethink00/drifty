import { PageTabs } from "../../components/PageTabs";
import { useLocalization } from "../localization/LocalizationContext";
import { isInsightsReadTabEnabled } from "./insightsReadTab";

export type InsightsTabId = "usage" | "read" | "achievements";

const INSIGHTS_TAB_CATALOG = [
  { id: "usage", labelKey: "trends.tab.usage" },
  { id: "read", labelKey: "trends.tab.coach" },
  { id: "achievements", labelKey: "trends.tab.achievements" },
] as const satisfies readonly {
  readonly id: InsightsTabId;
  readonly labelKey: "trends.tab.usage" | "trends.tab.coach" | "trends.tab.achievements";
}[];

/** Visible Insights tabs. Flip `INSIGHTS_READ_TAB_ENABLED` to restore Your read. */
export const INSIGHTS_TABS = INSIGHTS_TAB_CATALOG.filter((tab) => (
  tab.id !== "read" || isInsightsReadTabEnabled()
));

type InsightsTabsProps = {
  readonly activeTab: InsightsTabId;
  readonly onChange: (tab: InsightsTabId) => void;
  /** Marks the Achievements tab while it holds achievements not shown yet. */
  readonly hasNewAchievements?: boolean;
};

/** Section switch for the Insights page, on the shared page tabs. */
export function InsightsTabs({ activeTab, onChange, hasNewAchievements = false }: InsightsTabsProps) {
  const { t } = useLocalization();
  return (
    <PageTabs
      tabs={INSIGHTS_TABS.map((tab) => ({
        id: tab.id,
        label: t(tab.labelKey),
        badgeLabel: tab.id === "achievements" && hasNewAchievements && activeTab !== "achievements" ? t("achievements.newBadge") : undefined,
      }))}
      activeTab={activeTab}
      onChange={onChange}
      ariaLabel={t("trends.tabsAria")}
      idPrefix="insights"
    />
  );
}
