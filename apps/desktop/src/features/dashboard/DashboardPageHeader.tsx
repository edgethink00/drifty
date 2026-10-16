import type { ReactNode } from "react";
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
  const localizeDashboard = dashPeriod === "Today" || (dashPeriod === "Week" && effectiveLanguage !== "en");
  const titleAriaLabel = initialDataLoading
    ? (localizeDashboard ? t("dashboard.today.loading") : "Loading dashboard data")
    : focusDuration === null
      ? (localizeDashboard ? t("dashboard.today.noFocus") : "No focus recorded")
      : (localizeDashboard ? t("dashboard.today.headerAria", { duration: focusDuration }) : `Focused for ${focusDuration}`);

  return (
    <div className={`pg-head dashboard-page-head dashboard-page-head--focus-summary${dashPeriod === "Today" || dashPeriod === "Week" ? " dashboard-page-head--today" : ""}`}>
      <div className="dashboard-page-head__row">
        <div className="dashboard-page-head__primary">
          <div className="dashboard-page-head__summary">
            <h1 aria-label={titleAriaLabel} className="dashboard-page-head__title">
              {initialDataLoading ? (
                <><span className="dashboard-page-head__focus-word">{localizeDashboard ? t("dashboard.today.loading") : "Focused for"}</span><span className="loading-skeleton-line loading-skeleton-line--metric" aria-hidden="true" /></>
              ) : focusDuration === null ? (
                <span className="dashboard-page-head__focus-word">{localizeDashboard ? t("dashboard.today.noFocus") : "No focus recorded"}</span>
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
