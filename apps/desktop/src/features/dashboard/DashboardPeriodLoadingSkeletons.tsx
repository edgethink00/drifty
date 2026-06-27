import type { ReactNode } from "react";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_CELLS = Array.from({ length: 35 }, (_, index) => index);

export function WeekDashboardLoadingSkeleton({ dateNavigator }: { readonly dateNavigator: ReactNode }) {
  return (
    <section
      className="week-v2 dashboard-loading-skeleton dashboard-loading-skeleton--week"
      role="status"
      aria-live="polite"
      aria-label="Loading dashboard data"
    >
      <div className="week-v2-grid week-v2-grid--calendar">
        <section className="week-v2-calendar editorial-panel editorial-panel--soft" aria-hidden="true">
          <div className="week-v2-summary week-v2-summary--compact week-v2-summary--integrated">
            <div className="week-v2-summary__main">
              <span className="loading-skeleton-line loading-skeleton-line--label" />
              <strong><span className="loading-skeleton-line loading-skeleton-line--metric" /></strong>
            </div>
            <div className="week-v2-summary__bars">
              {WEEKDAY_LABELS.map((label, index) => (
                <span className="week-v2-summary__bar is-empty" key={label}>
                  <span className="week-v2-summary__bar-fill" style={{ height: `${8 + (index % 4) * 7}px` }} />
                  <small>{label.charAt(0)}</small>
                </span>
              ))}
            </div>
            <div className="week-v2-summary__meta">
              <span className="loading-skeleton-line loading-skeleton-line--detail" />
              <span className="loading-skeleton-line loading-skeleton-line--detail" />
              <span className="loading-skeleton-line loading-skeleton-line--detail" />
            </div>
            <div className="week-v2-summary__actions">{dateNavigator}</div>
          </div>
          <div className="week-v2-calendar__legend">
            {Array.from({ length: 5 }, (_, index) => (
              <span className="week-v2-calendar__legend-item" key={index}>
                <span className="loading-skeleton-dot" />
                <span className="loading-skeleton-line loading-skeleton-line--label" />
              </span>
            ))}
          </div>
          <div className="week-v2-calendar__scroller">
            <div className="week-v2-calendar__day-head">
              <span />
              {WEEKDAY_LABELS.map((label) => (
                <span key={label}>
                  <strong>{label}</strong>
                  <small><span className="loading-skeleton-line loading-skeleton-line--rank" /></small>
                </span>
              ))}
            </div>
            <div className="week-v2-calendar__body">
              <div className="week-v2-calendar__time-rail">
                {Array.from({ length: 8 }, (_, index) => (
                  <span key={index} style={{ top: `${index * 12.5}%` }} />
                ))}
              </div>
              {WEEKDAY_LABELS.map((label, dayIndex) => (
                <div className="week-v2-calendar__day-column" key={label}>
                  {Array.from({ length: 7 }, (_, index) => (
                    <span className="week-v2-calendar__line" key={index} style={{ top: `${index * 14.28}%` }} />
                  ))}
                  {Array.from({ length: 3 }, (_, index) => (
                    <span
                      className="week-v2-calendar__event week-v2-calendar__event--neutral dashboard-skeleton-week-event"
                      key={index}
                      style={{
                        height: `${34 + ((dayIndex + index) % 2) * 18}px`,
                        top: `${8 + (index * 26) + ((dayIndex % 2) * 5)}%`,
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

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
