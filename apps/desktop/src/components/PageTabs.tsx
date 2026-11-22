import type { KeyboardEvent } from "react";

export type PageTab<Id extends string> = {
  readonly id: Id;
  readonly label: string;
  /** Shows a small dot after the label and names it for screen readers, e.g. "New achievements". */
  readonly badgeLabel?: string;
};

type PageTabsProps<Id extends string> = {
  readonly tabs: readonly PageTab<Id>[];
  readonly activeTab: Id;
  readonly onChange: (tab: Id) => void;
  readonly ariaLabel: string;
  /** Tab ids render as `${idPrefix}-tab-${id}` so panels can point back at them. */
  readonly idPrefix: string;
  /** One shared panel for every tab; otherwise each tab controls `${idPrefix}-tabpanel-${id}`. */
  readonly panelId?: string;
};

export function pageTabId(idPrefix: string, tab: string): string {
  return `${idPrefix}-tab-${tab}`;
}

/** Section switch for a page header. Underlined text tabs stay visually
 *  distinct from the range segmented control that shares the same toolbar, so
 *  the two controls never read as one stacked filter. Insights and Teams share
 *  this so their section switches cannot drift apart. */
export function PageTabs<Id extends string>({ tabs, activeTab, onChange, ariaLabel, idPrefix, panelId }: PageTabsProps<Id>) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const currentIndex = tabs.findIndex((tab) => tab.id === activeTab);
    if (currentIndex < 0) return;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;
    event.preventDefault();
    onChange(nextTab.id);
    document.getElementById(pageTabId(idPrefix, nextTab.id))?.focus();
  }

  return (
    <div className="page-tabs" role="tablist" aria-label={ariaLabel} onKeyDown={handleKeyDown}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            id={pageTabId(idPrefix, tab.id)}
            type="button"
            role="tab"
            aria-controls={panelId ?? `${idPrefix}-tabpanel-${tab.id}`}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={isActive ? "page-tab is-active" : "page-tab"}
            onClick={() => onChange(tab.id)}
          >
            <span>{tab.label}</span>
            {tab.badgeLabel ? <span className="page-tab__dot" role="img" aria-label={tab.badgeLabel} /> : null}
          </button>
        );
      })}
    </div>
  );
}
