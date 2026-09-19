import type { ReactNode } from "react";

export function WeekDashboardLoadingLegend({ trailing }: { readonly trailing?: ReactNode }) {
  return (
    <div className="flow-chart-head__actions">
      <span aria-hidden="true" className="loading-skeleton-line loading-skeleton-line--control dashboard-skeleton-week-mode" />
      {trailing}
      <div aria-hidden="true" className="flow-chart-legend dashboard-skeleton-week-legend">
        {Array.from({ length: 3 }, (_, index) => (
          <span className="dashboard-skeleton-week-legend__item" key={index}>
            <span className="loading-skeleton-dot" />
            <span className="loading-skeleton-line loading-skeleton-line--label" />
          </span>
        ))}
      </div>
    </div>
  );
}

export function WeekDashboardLoadingBreakdown() {
  return (
    <>
      <section className="flow-compact-split-chart__panel flow-compact-split-chart__panel--circle dashboard-skeleton-panel" aria-hidden="true">
        <span className="loading-skeleton-line loading-skeleton-line--label" />
        <span className="dashboard-skeleton-panel-bed dashboard-skeleton-panel-bed--circle" />
      </section>
      <section className="flow-compact-split-chart__panel dashboard-skeleton-panel" aria-hidden="true">
        <span className="loading-skeleton-line loading-skeleton-line--label" />
        <span className="dashboard-skeleton-panel-bed dashboard-skeleton-panel-bed--list" />
      </section>
      <section className="week-v2-side-card week-v2-side-card--weekly-breakdown dashboard-skeleton-panel" aria-hidden="true">
        <span className="loading-skeleton-line loading-skeleton-line--label" />
        <span className="dashboard-skeleton-panel-bed dashboard-skeleton-panel-bed--week-chart" />
      </section>
      <div className="kpi-row kpi-row--insights insight-summary dashboard-skeleton-week-kpis" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <article className="metric-tile insight-summary__tile" key={index}>
            <span className="dashboard-skeleton-panel-bed dashboard-skeleton-panel-bed--tile" />
          </article>
        ))}
      </div>
    </>
  );
}
