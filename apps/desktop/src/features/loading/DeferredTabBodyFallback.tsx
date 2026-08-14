type DeferredTabBodyFallbackProps = {
  readonly label: string;
  readonly variant: "history" | "trends";
};

export function DeferredTabBodyFallback({ label, variant }: DeferredTabBodyFallbackProps) {
  if (variant === "history") {
    return <HistoryDeferredFallback label={label} />;
  }

  return <TrendsDeferredFallback label={label} />;
}

function HistoryDeferredFallback({ label }: { readonly label: string }) {
  return (
    <section
      className="deferred-tab-skeleton deferred-tab-skeleton--history history-view"
      role="status"
      aria-live="polite"
      aria-label={`Loading ${label}`}
    >
      <strong className="deferred-tab-skeleton__status">Loading {label}...</strong>
      <div className="history-view__toolbar" aria-hidden="true">
        <label className="history-search">
          <span className="loading-skeleton-icon" />
          <span className="loading-skeleton-line loading-skeleton-line--search" />
        </label>
        <button className="app-btn app-btn--danger" disabled type="button">
          Delete selected
        </button>
      </div>
      <div className="history-groups" aria-hidden="true">
        <section className="history-group">
          <h2><span className="loading-skeleton-line loading-skeleton-line--label" /></h2>
          <div className="history-list">
            {Array.from({ length: 9 }, (_, index) => (
              <article className="history-row history-row--skeleton" key={index}>
                <span className="history-row__check"><span className="loading-skeleton-checkbox" /></span>
                <span className="history-row__time">
                  <span className="loading-skeleton-line loading-skeleton-line--time" />
                  <strong><span className="loading-skeleton-line loading-skeleton-line--duration" /></strong>
                </span>
                <span className="history-row__identity">
                  <span className="loading-skeleton-avatar loading-skeleton-avatar--sm" />
                  <span className="history-row__identity-copy">
                    <span className="loading-skeleton-line loading-skeleton-line--title" />
                    <span className="loading-skeleton-line loading-skeleton-line--detail" />
                  </span>
                </span>
                <span className="history-row__category">
                  <span className="loading-skeleton-line loading-skeleton-line--category" />
                  <span className="loading-skeleton-dot" />
                </span>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

function TrendsDeferredFallback({ label }: { readonly label: string }) {
  return (
    <section
      className="deferred-tab-skeleton deferred-tab-skeleton--trends"
      role="status"
      aria-live="polite"
      aria-label={`Loading ${label}`}
    >
      <strong className="deferred-tab-skeleton__status">Loading {label}...</strong>
      <section className="insights-row--weekly-categories weekly-cat-row" aria-hidden="true">
        <section className="editorial-panel editorial-panel--soft insight-section weekly-productivity-trend-card deferred-trends-weekly-chart">
          <div className="weekly-productivity-trend-card__head">
            <div><span className="loading-skeleton-line loading-skeleton-line--label" /></div>
            <div className="wt-toggle">
              <span className="loading-skeleton-line loading-skeleton-line--control" />
            </div>
          </div>
          <div className="wt-plot deferred-tab-skeleton__block deferred-tab-skeleton__block--weekly-chart" />
        </section>
        <section className="editorial-panel editorial-panel--soft insight-section od-cat-rebuilt weekly-summary-rail weekly-breakdown-analytical is-linked">
          <div className="deferred-tab-skeleton__block deferred-tab-skeleton__block--weekly-summary" />
        </section>
      </section>

      <div className="insight-grid attention-rhythm-radar-row productivity-focus-radar-row" aria-hidden="true">
        <section className="editorial-panel editorial-panel--soft productivity-persona-card productivity-persona-card--radar-only">
          <div className="deferred-tab-skeleton__block deferred-tab-skeleton__block--radar" />
        </section>
        <section
          id="insights-weekly-attention-rhythm"
          className="editorial-panel editorial-panel--soft insight-section productivity-rhythm-card productivity-rhythm-card--attention"
        >
          <div className="deferred-tab-skeleton__block deferred-tab-skeleton__block--rhythm" />
        </section>
      </div>

      <div className="insight-grid productivity-insight-groups" aria-hidden="true">
        {[
          ["drift", "compact"],
          ["focus", "tall"],
        ].map(([kind, height]) => (
          <section
            className={`editorial-panel editorial-panel--soft insight-section productivity-insight-group productivity-insight-group--${kind}`}
            key={kind}
          >
            <div
              className={`deferred-tab-skeleton__block deferred-tab-skeleton__block--source-group deferred-tab-skeleton__block--source-group-${height}`}
            />
          </section>
        ))}
      </div>
    </section>
  );
}
