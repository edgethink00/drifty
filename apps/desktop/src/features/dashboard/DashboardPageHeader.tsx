import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useLocalization } from "../localization/LocalizationContext";
import type { DashboardPeriod } from "./dashboardPeriods";

type DashboardPageHeaderProps = {
  readonly dashPeriod: DashboardPeriod;
  readonly initialDataLoading: boolean;
  readonly dateNavigator: ReactNode;
  readonly periodToggle?: ReactNode;
  readonly deviceSelect?: ReactNode;
  readonly headerAction?: ReactNode;
  readonly focusDuration: string | null;
};

const ICON_ACTION_ATTRIBUTE = "data-header-action";

/**
 * Folds the header action (Share) to its round icon-only form only when the
 * labelled button would overlap the title, or push the date navigator off the
 * summary's row when the round button lets it stay.
 *
 * The decision always measures the labelled layout: the attribute is cleared,
 * widths are read, and the result is set again inside the same observer pass,
 * before paint. Measuring the labelled width every time keeps the result
 * independent of the current state, so the head cannot flip back and forth.
 */
function useIconOnlyHeaderAction(
  headRef: { readonly current: HTMLDivElement | null },
  contentKey: string,
) {
  useLayoutEffect(() => {
    const head = headRef.current;
    if (!head || typeof ResizeObserver === "undefined") return;
    const row = head.querySelector<HTMLElement>(".dashboard-page-head__row");
    const primary = head.querySelector<HTMLElement>(".dashboard-page-head__primary");
    const summary = head.querySelector<HTMLElement>(".dashboard-page-head__summary");
    const side = head.querySelector<HTMLElement>(".dashboard-page-head__side");
    if (!row || !primary || !summary || !side) return;

    const update = () => {
      const action = primary.querySelector<HTMLElement>(":scope > .app-btn--header-action");
      head.removeAttribute(ICON_ACTION_ATTRIBUTE);
      if (!action) return;
      const gap = (element: HTMLElement) => Number.parseFloat(getComputedStyle(element).columnGap) || 0;
      const width = (element: HTMLElement) => element.getBoundingClientRect().width;
      const available = row.clientWidth + 0.5;
      // The summary may already have shrunk while its unwrapped title
      // overflows it. Measure that content, not just the shrunken box.
      const primaryContent = Math.max(width(summary), summary.scrollWidth) + gap(primary);
      const rest = primaryContent + gap(row) + width(side);
      // The round button is as wide as the labelled button is tall.
      const iconWidth = action.getBoundingClientRect().height;
      const labelledWidth = width(action);
      const needsRoomForTitle = primaryContent + labelledWidth > available && primaryContent + iconWidth <= available;
      const keepsNavigationOnRow = rest + labelledWidth > available && rest + iconWidth <= available;
      if (needsRoomForTitle || keepsNavigationOnRow) {
        head.setAttribute(ICON_ACTION_ATTRIBUTE, "icon");
      }
    };

    update();
    const observer = new ResizeObserver(update);
    // The primary group resizes when Share appears or its label changes.
    for (const element of [row, primary, summary, side]) observer.observe(element);
    return () => {
      observer.disconnect();
      head.removeAttribute(ICON_ACTION_ATTRIBUTE);
    };
  }, [headRef, contentKey]);
}

export function DashboardPageHeader({
  dashPeriod,
  initialDataLoading,
  dateNavigator,
  periodToggle,
  deviceSelect,
  headerAction,
  focusDuration,
}: DashboardPageHeaderProps) {
  const { effectiveLanguage, t } = useLocalization();
  const headRef = useRef<HTMLDivElement>(null);
  useIconOnlyHeaderAction(headRef, `${effectiveLanguage}:${dashPeriod}:${initialDataLoading}:${focusDuration}`);
  const localizeDashboard = dashPeriod === "Today" || (dashPeriod === "Week" && effectiveLanguage !== "en");
  const titleAriaLabel = initialDataLoading
    ? (localizeDashboard ? t("dashboard.today.loading") : "Loading dashboard data")
    : focusDuration === null
      ? (localizeDashboard ? t("dashboard.today.noFocus") : "No focus recorded")
      : (localizeDashboard ? t("dashboard.today.headerAria", { duration: focusDuration }) : `Focused for ${focusDuration}`);

  const localizedFocus = t("dashboard.today.focused", { duration: "__DRIFTY_DURATION__" }).split("__DRIFTY_DURATION__");
  return (
    <div ref={headRef} className={`pg-head dashboard-page-head dashboard-page-head--focus-summary${dashPeriod === "Today" || dashPeriod === "Week" ? " dashboard-page-head--today" : ""}`}>
      <div className="dashboard-page-head__row">
        <div className="dashboard-page-head__primary">
          <div className="dashboard-page-head__summary">
            <h1 aria-label={titleAriaLabel} className="dashboard-page-head__title">
              {initialDataLoading ? (
                <><span className="dashboard-page-head__focus-word">{localizeDashboard ? t("dashboard.today.loading") : "Focused for"}</span><span className="loading-skeleton-line loading-skeleton-line--metric" aria-hidden="true" /></>
              ) : focusDuration === null ? (
                <span className="dashboard-page-head__focus-word">{localizeDashboard ? t("dashboard.today.noFocus") : "No focus recorded"}</span>
              ) : localizeDashboard && !["en", "ko", "es"].includes(effectiveLanguage) ? (
                <>{localizedFocus[0] && <span className="dashboard-page-head__focus-word">{localizedFocus[0]}</span>}<span className="dashboard-page-head__focus-value">{focusDuration}</span>{localizedFocus[1] && <span className="dashboard-page-head__focus-word">{localizedFocus[1]}</span>}</>
              ) : localizeDashboard && effectiveLanguage === "ko" ? (
                <><span className="dashboard-page-head__focus-value">{focusDuration}</span><span className="dashboard-page-head__focus-word">집중했습니다</span></>
              ) : localizeDashboard && effectiveLanguage === "es" ? (
                <><span className="dashboard-page-head__focus-word">Tiempo de concentración:</span><span className="dashboard-page-head__focus-value">{focusDuration}</span></>
              ) : (
                <><span className="dashboard-page-head__focus-word">Focused for</span><span className="dashboard-page-head__focus-value">{focusDuration}</span></>
              )}
            </h1>
          </div>
          {headerAction}
        </div>
        <div className={`dashboard-page-head__side${periodToggle ? " dashboard-page-head__side--period-toggle" : ""}${deviceSelect ? " dashboard-page-head__side--device-select" : ""}`}>
          {periodToggle}
          {deviceSelect}
          {dateNavigator}
        </div>
      </div>
    </div>
  );
}
