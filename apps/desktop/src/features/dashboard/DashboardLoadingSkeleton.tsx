import type { DashboardPeriod } from "./dashboardPeriods";
import { useLocalization } from "../localization/LocalizationContext";
import { MonthDashboardLoadingSkeleton } from "./DashboardPeriodLoadingSkeletons";

type DashboardLoadingSkeletonProps = {
  readonly dashPeriod: Exclude<DashboardPeriod, "Week">;
};

export function DashboardLoadingSkeleton({ dashPeriod }: DashboardLoadingSkeletonProps) {
  if (dashPeriod === "Month") {
    return <MonthDashboardLoadingSkeleton />;
  }

  return <TodayDashboardLoadingSkeleton />;
}

function TodayDashboardLoadingSkeleton() {
  const { t } = useLocalization();

  return (
    <>
      <div
        className="flow-breakdown-layout dashboard-loading-skeleton dashboard-loading-skeleton--today"
        role="status"
        aria-live="polite"
        aria-label={t("dashboard.loadingAria")}
      >
        <div className="flow-breakdown-layout__chart dashboard-skeleton-panel dashboard-skeleton-panel--flow" aria-hidden="true">
          <div className="dashboard-skeleton-flow-head">
            <span className="loading-skeleton-line loading-skeleton-line--label" />
            <span className="loading-skeleton-line loading-skeleton-line--control" />
          </div>
          <div className="dashboard-skeleton-flow-chart dashboard-skeleton-flow-chart--surface">
            <div className="dashboard-skeleton-flow-bed" />
          </div>
        </div>

        <div className="flow-compact-split-chart" aria-hidden="true">
          <section className="flow-compact-split-chart__panel flow-compact-split-chart__panel--circle dashboard-skeleton-panel">
            <div className="flow-compact-split-chart__head">
              <span className="loading-skeleton-line loading-skeleton-line--label" />
              <span className="loading-skeleton-line loading-skeleton-line--value" />
            </div>
            <div className="dashboard-skeleton-panel-bed dashboard-skeleton-panel-bed--circle" />
          </section>
          <section className="flow-compact-split-chart__panel dashboard-skeleton-panel">
            <div className="flow-compact-split-chart__head">
              <span className="loading-skeleton-line loading-skeleton-line--label" />
              <span className="loading-skeleton-line loading-skeleton-line--value" />
            </div>
            <div className="dashboard-skeleton-panel-bed dashboard-skeleton-panel-bed--list" />
          </section>
        </div>
      </div>

      <div className="dashboard-insight-stack dashboard-loading-skeleton__insights" aria-hidden="true">
        <section className="editorial-panel editorial-panel--soft dashboard-skeleton-panel">
          <span className="loading-skeleton-line loading-skeleton-line--label" />
          <div className="dashboard-skeleton-panel-bed dashboard-skeleton-panel-bed--score" />
        </section>
        <section className="insight-summary">
          {Array.from({ length: 6 }, (_, index) => (
            <article className="insight-summary__tile" key={index}>
              <span className="dashboard-skeleton-panel-bed dashboard-skeleton-panel-bed--tile" />
            </article>
          ))}
        </section>
      </div>

      <section className="app-usage-panel editorial-panel editorial-panel--soft app-usage-panel--loading" aria-hidden="true">
        <div className="app-usage-content">
          <article className="app-usage-feature dashboard-skeleton-panel">
            <div className="app-usage-feature__identity">
              <span className="loading-skeleton-avatar loading-skeleton-avatar--md" />
              <div>
                <span className="loading-skeleton-line loading-skeleton-line--label" />
                <span className="loading-skeleton-line loading-skeleton-line--title" />
                <span className="loading-skeleton-line loading-skeleton-line--detail" />
              </div>
            </div>
            <div className="app-usage-feature__meter-block">
              <span className="loading-skeleton-line loading-skeleton-line--detail" />
              <span className="loading-skeleton-fill" />
            </div>
            <div className="app-usage-feature__stats">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index}>
                  <span className="loading-skeleton-line loading-skeleton-line--label" />
                  <span className="loading-skeleton-line loading-skeleton-line--value" />
                </div>
              ))}
            </div>
          </article>
          <ol className="app-usage-list">
            {Array.from({ length: 5 }, (_, index) => (
              <li className="app-usage-row" key={index}>
                <span className="loading-skeleton-line loading-skeleton-line--rank" />
                <span className="app-usage-row__main">
                  <span className="loading-skeleton-avatar loading-skeleton-avatar--sm" />
                  <span className="app-usage-row__copy">
                    <span className="loading-skeleton-line loading-skeleton-line--title" />
                    <span className="loading-skeleton-line loading-skeleton-line--detail" />
                  </span>
                </span>
                <span className="app-usage-row__bar"><span /></span>
                <span className="app-usage-row__figures">
                  <span className="loading-skeleton-line loading-skeleton-line--value" />
                  <span className="loading-skeleton-line loading-skeleton-line--detail" />
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
