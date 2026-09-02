const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_CELLS = Array.from({ length: 35 }, (_, index) => index);

export function MonthDashboardLoadingSkeleton() {
  return (
    <section
      className="month-v2 dashboard-loading-skeleton dashboard-loading-skeleton--month"
      role="status"
      aria-live="polite"
      aria-label="Loading dashboard data"
    >
      <div className="month-v2-story" aria-hidden="true">
        <div>
          <span className="loading-skeleton-line loading-skeleton-line--label" />
          <strong><span className="loading-skeleton-line loading-skeleton-line--metric" /></strong>
        </div>
        <div className="month-v2-story__notes">
          {Array.from({ length: 4 }, (_, index) => (
            <span key={index}><span className="loading-skeleton-line loading-skeleton-line--detail" /></span>
          ))}
        </div>
      </div>
      <div className="month-v2-grid" aria-hidden="true">
        <div className="month-v2-top-row">
          <section className="month-v2-calendar editorial-panel editorial-panel--soft">
            <div className="month-v2-calendar__head">
              <span className="loading-skeleton-line loading-skeleton-line--label" />
              <strong><span className="loading-skeleton-line loading-skeleton-line--title" /></strong>
              <span className="month-v2-calendar__legend">
                <span className="month-v2-legend-ramp">
                  {Array.from({ length: 4 }, (_, index) => <span className="month-v2-legend-dot" key={index} />)}
                </span>
              </span>
            </div>
            <div className="month-v2-calendar__weekdays">
              {WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}
            </div>
            <div className="month-v2-calendar__grid">
              {MONTH_CELLS.map((index) => (
                <span className="month-v2-cell dashboard-skeleton-month-cell" key={index}>
                  <span className="loading-skeleton-line loading-skeleton-line--rank" />
                  <span className="loading-skeleton-line loading-skeleton-line--detail" />
                </span>
              ))}
            </div>
          </section>
          <aside className="month-v2-side month-v2-side--top">
            <section className="editorial-panel editorial-panel--soft month-v2-side-card">
              <span className="loading-skeleton-line loading-skeleton-line--label" />
              <div className="month-v2-metric-list">
                {Array.from({ length: 5 }, (_, index) => (
                  <span className="dashboard-skeleton-legend-row" key={index}>
                    <span className="loading-skeleton-dot" />
                    <span className="loading-skeleton-line" />
                    <span className="loading-skeleton-line loading-skeleton-line--value" />
                  </span>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}
