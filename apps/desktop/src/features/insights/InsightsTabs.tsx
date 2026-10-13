import { PageTabs } from "../../components/PageTabs";
import { useLocalization } from "../localization/LocalizationContext";
import { isInsightsReadTabEnabled } from "./insightsReadTab";

export type InsightsTabId = "usage" | "read";

const INSIGHTS_TAB_CATALOG = [
  { id: "usage", labelKey: "trends.tab.usage" },
  { id: "read", labelKey: "trends.tab.coach" },
] as const satisfies readonly {
  readonly id: InsightsTabId;
  readonly labelKey: "trends.tab.usage" | "trends.tab.coach";
}[];

/** Visible Insights tabs. Flip `INSIGHTS_READ_TAB_ENABLED` to restore Your read. */
export const INSIGHTS_TABS = INSIGHTS_TAB_CATALOG.filter((tab) => (
  tab.id === "usage" || isInsightsReadTabEnabled()
));

type InsightsTabsProps = {
  readonly activeTab: InsightsTabId;
  readonly onChange: (tab: InsightsTabId) => void;
};

/** Section switch for the Insights page, on the shared page tabs. */
export function InsightsTabs({ activeTab, onChange }: InsightsTabsProps) {
  const { t } = useLocalization();
  return (
    <PageTabs
      tabs={INSIGHTS_TABS.map((tab) => ({ id: tab.id, label: t(tab.labelKey) }))}
      activeTab={activeTab}
      onChange={onChange}
      ariaLabel={t("trends.tabsAria")}
      idPrefix="insights"
    />
  );
}
