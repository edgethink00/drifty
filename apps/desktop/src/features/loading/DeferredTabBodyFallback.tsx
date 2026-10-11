import { ActionLabel } from "../../components/ActionLabel";
import { historyToolbarActionReserve } from "../history/historyToolbar";
import { useLocalization } from "../localization/LocalizationContext";

type DeferredTabBodyFallbackProps = {
  readonly label: string;
  readonly variant: "history" | "trends";
};

export function DeferredTabBodyFallback({ label, variant }: DeferredTabBodyFallbackProps) {
  const { effectiveLanguage, t } = useLocalization();
  // The English label names what is loading; other languages use the tab name,
  // like the page-level fallback, instead of an English sentence.
  const localizedLabel = effectiveLanguage === "en" ? label : t(variant === "history" ? "nav.history" : "nav.trends");
  const status = { text: t("loading.page", { label: localizedLabel }), aria: t("loading.pageAria", { label: localizedLabel }) };
  if (variant === "history") {
    return <HistoryDeferredFallback status={status} />;
  }

  return <TrendsDeferredFallback status={status} />;
}

type FallbackStatus = { readonly text: string; readonly aria: string };

function HistoryDeferredFallback({ status }: { readonly status: FallbackStatus }) {
  const { t } = useLocalization();
  return (
    <section
      className="deferred-tab-skeleton deferred-tab-skeleton--history history-view"
      role="status"
      aria-live="polite"
      aria-label={status.aria}
    >
      <strong className="deferred-tab-skeleton__status">{status.text}</strong>
      <div className="history-view__toolbar" aria-hidden="true">
        <label className="history-search">
          <span className="loading-skeleton-icon" />
          <span className="loading-skeleton-line loading-skeleton-line--search" />
        </label>
        <button className="app-btn app-btn--secondary history-delete-all history-toolbar-action" disabled type="button">
          <ActionLabel busy={false} reserve={historyToolbarActionReserve(t)}>{t("history.deleteAll")}</ActionLabel>
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

function TrendsDeferredFallback({ status }: { readonly status: FallbackStatus }) {
  return (
    <div
      className="insights-tabpanel insights-tabpanel--usage insights-reduced insights-retained insights-stacked insights-stacked--k insights-fit-window deferred-tab-skeleton deferred-tab-skeleton--trends"
      data-calendar-placement="right-bottom"
      role="status"
      aria-live="polite"
      aria-label={status.aria}
    >
      <strong className="deferred-tab-skeleton__status">{status.text}</strong>
      <div className="insights-stacked__columns" aria-hidden="true">
        {/* Left column: patterns */}
        <div className="insights-stacked__patterns">
          {/* 1. Alarm follow-through card */}
          <section className="alarm-follow-through editorial-panel editorial-panel--soft insight-section" data-alarm-layout="baseline" data-alarm-structure="split-led">
            <div className="alarm-follow-through__head">
              <div className="insight-section__label">
                <span className="loading-skeleton-line loading-skeleton-line--label" />
              </div>
              <span className="alarm-follow-through__total">
                <span className="loading-skeleton-line loading-skeleton-line--value" style={{ width: "3.5rem" }} />
              </span>
            </div>

            <div className="alarm-follow-through__lede">
              <div className="alarm-follow-through__metric">
                <span className="loading-skeleton-line loading-skeleton-line--metric" />
                <span className="loading-skeleton-line loading-skeleton-line--detail" />
              </div>
              <div className="alarm-follow-through__median">
                <span className="loading-skeleton-line loading-skeleton-line--time" />
              </div>
            </div>

            <div className="alarm-follow-through__paths">
              {Array.from({ length: 4 }, (_, index) => (
                <div className="alarm-follow-through__row" key={index}>
                  <div className="alarm-follow-through__meta">
                    <span className="loading-skeleton-line loading-skeleton-line--label" style={{ width: "4.5rem" }} />
                    <span className="loading-skeleton-line loading-skeleton-line--rank" />
                  </div>
                  <div className="alarm-follow-through__bar">
                    <span className="loading-skeleton-fill" style={{ width: `${80 - index * 18}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 2. Attention rhythm card */}
          <section
            id="insights-weekly-attention-rhythm"
            className="editorial-panel editorial-panel--soft insight-section productivity-rhythm-card productivity-rhythm-card--attention"
          >
            <div className="productivity-rhythm-card__head productivity-rhythm-card__head--attention">
              <div>
                <span className="loading-skeleton-line loading-skeleton-line--label" />
              </div>
              <div className="productivity-rhythm-card__legend">
                <span className="productivity-rhythm-card__legend-item">
                  <span className="loading-skeleton-dot" />
                  <span className="loading-skeleton-line loading-skeleton-line--time" style={{ width: "2rem" }} />
                </span>
                <span className="productivity-rhythm-card__legend-item">
                  <span className="loading-skeleton-dot" />
                  <span className="loading-skeleton-line loading-skeleton-line--time" style={{ width: "2rem" }} />
                </span>
                <span className="productivity-rhythm-card__legend-item">
                  <span className="loading-skeleton-dot" />
                  <span className="loading-skeleton-line loading-skeleton-line--time" style={{ width: "2rem" }} />
                </span>
              </div>
            </div>
            <div className="deferred-tab-skeleton__block deferred-tab-skeleton__block--rhythm" />
          </section>

          {/* 3. Source groups (Drift & Focus) */}
          <div className="insight-grid productivity-insight-groups">
            {(["drift", "focus"] as const).map((kind) => (
              <section
                className={`editorial-panel editorial-panel--soft insight-section productivity-insight-group productivity-insight-group--${kind}`}
                key={kind}
              >
                <div className="drift-time-trend__sources">
                  <div className="insight-source-heading">
                    <span className="loading-skeleton-line loading-skeleton-line--label" />
                    <span className="loading-skeleton-line loading-skeleton-line--label" style={{ width: "4rem" }} />
                  </div>
                  <div className="drift-time-trend__sources-items">
                    {Array.from({ length: 2 }, (_, index) => (
                      <div className="drift-time-trend__sources-item" key={index}>
                        <span className="loading-skeleton-line loading-skeleton-line--rank" />
                        <span className="loading-skeleton-avatar loading-skeleton-avatar--sm" />
                        <div className="drift-time-trend__sources-body">
                          <span className="loading-skeleton-line loading-skeleton-line--title" style={{ width: "7rem" }} />
                          <span className="loading-skeleton-fill" style={{ width: index === 0 ? "85%" : "50%", marginTop: "3px" }} />
                        </div>
                        <span className="loading-skeleton-line loading-skeleton-line--duration" />
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            ))}
          </div>
        </div>

        {/* Right column: breakdown */}
        <div className="insights-stacked__breakdown">
          {/* 1. Weekly breakdown */}
          <div className="insights-row--weekly-categories insights-row--weekly-categories--all weekly-cat-row">
            <section className="editorial-panel editorial-panel--soft insight-section weekly-productivity-trend-card deferred-trends-weekly-chart">
              <div className="weekly-productivity-trend-card__head">
                <div className="wt-toggle">
                  <span className="loading-skeleton-line loading-skeleton-line--control" />
                </div>
              </div>
              <div className="wt-plot deferred-tab-skeleton__block deferred-tab-skeleton__block--weekly-chart" />
            </section>

            <section className="editorial-panel editorial-panel--soft insight-section od-cat-rebuilt weekly-summary-rail weekly-breakdown-analytical is-linked">
              <div className="weekly-summary-rail__stack weekly-breakdown-analytical__stack">
                <div className="flow-compact-split-chart__panel flow-compact-split-chart__panel--circle dashboard-skeleton-panel">
                  <div className="flow-compact-split-chart__head">
                    <span className="loading-skeleton-line loading-skeleton-line--label" />
                    <span className="loading-skeleton-line loading-skeleton-line--value" />
                  </div>
                  <div className="dashboard-skeleton-panel-bed dashboard-skeleton-panel-bed--circle" />
                </div>
                <div className="flow-compact-split-chart__panel dashboard-skeleton-panel">
                  <div className="flow-compact-split-chart__head">
                    <span className="loading-skeleton-line loading-skeleton-line--label" />
                    <span className="loading-skeleton-line loading-skeleton-line--value" />
                  </div>
                  <div className="dashboard-skeleton-panel-bed dashboard-skeleton-panel-bed--list" />
                </div>
              </div>
            </section>
          </div>

          {/* 2. Focus calendar */}
          <section className="focus-calendar editorial-panel editorial-panel--soft insight-section" data-calendar-variant="quarter">
            <div className="focus-calendar__head">
              <span className="loading-skeleton-line loading-skeleton-line--label" />
              <span className="loading-skeleton-line loading-skeleton-line--time" style={{ width: "4.5rem" }} />
            </div>
            <div className="deferred-tab-skeleton__block deferred-tab-skeleton__block--calendar" />
          </section>
        </div>
      </div>
    </div>
  );
}
