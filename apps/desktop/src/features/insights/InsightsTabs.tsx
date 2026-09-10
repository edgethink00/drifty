import type { KeyboardEvent } from "react";
import { useLocalization } from "../localization/LocalizationContext";
import { isInsightsReadTabEnabled } from "./insightsReadTab";

export type InsightsTabId = "usage" | "coach";

const INSIGHTS_TAB_CATALOG = [
  { id: "usage", labelKey: "trends.tab.usage" },
  { id: "coach", labelKey: "trends.tab.coach" },
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

/** Section switch for the Insights page. Underlined text tabs stay visually
 *  distinct from the range segmented control in the same page header, so the
 *  two controls never read as one stacked filter stack. */
export function InsightsTabs({ activeTab, onChange }: InsightsTabsProps) {
  const { t } = useLocalization();

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const currentIndex = INSIGHTS_TABS.findIndex((tab) => tab.id === activeTab);
    if (currentIndex < 0) return;
    const step = event.key === "ArrowRight" ? 1 : -1;
    const nextTab = INSIGHTS_TABS[(currentIndex + step + INSIGHTS_TABS.length) % INSIGHTS_TABS.length];
    if (!nextTab) return;
    event.preventDefault();
    onChange(nextTab.id);
  }

  return (
    <div className="insights-tabs" role="tablist" aria-label={t("trends.tabsAria")} onKeyDown={handleKeyDown}>
      {INSIGHTS_TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            id={`insights-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-controls={`insights-tabpanel-${tab.id}`}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={`insights-tab${isActive ? " is-active" : ""}`}
            onClick={() => onChange(tab.id)}
          >
            <span>{t(tab.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
