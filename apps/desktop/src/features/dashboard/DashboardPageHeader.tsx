import type { ReactNode } from "react";
import type { DashboardPeriod } from "./dashboardPeriods";

type DashboardPageHeaderProps = {
  readonly dashPeriod: DashboardPeriod;
  readonly initialDataLoading: boolean;
  readonly dateNavigator: ReactNode;
  readonly headerAction?: ReactNode;
  readonly focusDuration: string | null;
};

export function DashboardPageHeader({
  dashPeriod,
  initialDataLoading,
  dateNavigator,
  headerAction,
  focusDuration,
}: DashboardPageHeaderProps) {
  const titleAriaLabel = initialDataLoading
    ? "Loading dashboard data"
    : focusDuration === null
      ? "No focus recorded"
      : `Focused for ${focusDuration}`;

  return (
    <div className={`pg-head dashboard-page-head dashboard-page-head--focus-summary${dashPeriod === "Today" || dashPeriod === "Week" ? " dashboard-page-head--today" : ""}`}>
      <div className="dashboard-page-head__row">
        <div className="dashboard-page-head__summary">
          <h1 aria-label={titleAriaLabel} className="dashboard-page-head__title">
            {initialDataLoading ? (
              <><span className="dashboard-page-head__focus-word">Focused for</span><span className="loading-skeleton-line loading-skeleton-line--metric" aria-hidden="true" /></>
            ) : focusDuration === null ? (
              <span className="dashboard-page-head__focus-word">No focus recorded</span>
            ) : (
              <><span className="dashboard-page-head__focus-word">Focused for</span><span className="dashboard-page-head__focus-value">{focusDuration}</span></>
            )}
          </h1>
        </div>
        <div className="dashboard-page-head__side">
          {headerAction}
          {dateNavigator}
        </div>
      </div>
    </div>
  );
}
