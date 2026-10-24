import { ActionLabel } from "../../components/ActionLabel";
import { historyToolbarActionReserve } from "../history/historyToolbar";
// History's styles otherwise arrive with its lazy view; the placeholder needs
// them before that chunk loads, or its toolbar and rows render unstyled.
import "../history/history.css";
import { useLocalization } from "../localization/LocalizationContext";
import { CategoryPanelLoading, RingPanelLoading, SkeletonText, WeekChartPlotLoading } from "../dashboard/DashboardLoadingParts";

type DeferredTabBodyFallbackProps = {
  readonly label?: string;
  readonly variant: "history" | "trends";
  /** Insights' weekly chart offers Project beside Productivity and Category. */
  readonly projectModeAvailable?: boolean;
  /** The weekly chart's chosen grouping, pressed in the placeholder switch. */
  readonly weeklyChartMode?: "productivity" | "category" | "project";
};

export function DeferredTabBodyFallback({ label, variant, projectModeAvailable = false, weeklyChartMode = "category" }: DeferredTabBodyFallbackProps) {
  const { effectiveLanguage, t } = useLocalization();
  // The English label names what is loading; other languages use the tab name,
  // like the page-level fallback, instead of an English sentence.
  const localizedLabel = effectiveLanguage === "en" ? (label ?? (variant === "history" ? "history records" : "trend analysis")) : t(variant === "history" ? "nav.history" : "nav.trends");
  const status = { text: t("loading.page", { label: localizedLabel }), aria: t("loading.pageAria", { label: localizedLabel }) };
  if (variant === "history") {
    return <HistoryDeferredFallback status={status} />;
  }

  return <TrendsDeferredFallback status={status} projectModeAvailable={projectModeAvailable} weeklyChartMode={weeklyChartMode} />;
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
          <h2><SkeletonText>October 25, 2026</SkeletonText></h2>
          <div className="history-list">
            {Array.from({ length: 9 }, (_, index) => (
              // The loaded row's markup (HistoryRow) with its text held as placeholders.
              <div className="history-row-shell" key={index}>
                <div className="history-row history-row--skeleton">
                  <span className="history-row__check"><span className="loading-skeleton-checkbox" /></span>
                  <div className="history-row__time">
                    <span><SkeletonText>00:00 PM - 00:00 PM</SkeletonText></span>
                    <strong><SkeletonText>00m</SkeletonText></strong>
                  </div>
                  <div className="history-row__identity">
                    <span className="usage-identity-icon usage-identity-icon--sm history-row__identity-icon usage-identity-icon--loading" />
                    <div className="history-row__identity-copy">
                      <strong><SkeletonText>Activity title</SkeletonText></strong>
                      <span><SkeletonText>Application</SkeletonText></span>
                    </div>
                  </div>
                  <div className="history-row__category">
                    <span><SkeletonText>Category</SkeletonText></span>
                    <span className="loading-skeleton-dot" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

const RHYTHM_HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const RHYTHM_CELLS = Array.from({ length: 7 * 24 }, (_, index) => index);
const WEEKDAYS = Array.from({ length: 7 }, (_, index) => index);
const SOURCE_ROWS = [0, 1, 2] as const;

/**
 * Insights while its body loads, in the loaded layout (the fit-window stack
 * with the calendar at the bottom right and no alarm card, which only appears
 * once alarms exist): the attention rhythm, the drift and focus sources, the
 * weekly chart with its productivity and category rail, and the calendar.
 * Each card uses the loaded card's classes; fixed words stay as text and the
 * values wait as placeholders.
 */
function TrendsDeferredFallback({ status, projectModeAvailable, weeklyChartMode }: {
  readonly status: FallbackStatus;
  readonly projectModeAvailable: boolean;
  readonly weeklyChartMode: "productivity" | "category" | "project";
}) {
  const { t } = useLocalization();
  const sourceGroups = [
    { kind: "drift", lists: ["trends.driftApps", "trends.driftAfterFocus"] },
    { kind: "focus", lists: ["trends.focusApps", "trends.focusBeforeDrift"] },
  ] as const;
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
        <div className="insights-stacked__patterns">
          {/* The loaded card's id carries its fit-window size, so the placeholder keeps it. */}
          <section id="insights-weekly-attention-rhythm" className="editorial-panel editorial-panel--soft insight-section productivity-rhythm-card productivity-rhythm-card--attention">
            <div className="productivity-rhythm-card__head productivity-rhythm-card__head--attention">
              <div><span className="label-mono insight-section__label">{t("trends.attentionRhythm")}</span></div>
              <div className="productivity-rhythm-card__legend">
                <span className="productivity-rhythm-card__legend-item"><span className="productivity-rhythm-card__legend-dot productivity-rhythm-card__legend-dot--focus" /><span>{t("activity.productivity.focus")}</span></span>
                <span className="productivity-rhythm-card__legend-item"><span className="productivity-rhythm-card__legend-dot productivity-rhythm-card__legend-dot--drift" /><span>{t("activity.productivity.drift")}</span></span>
                <span className="productivity-rhythm-card__legend-item"><span className="productivity-rhythm-card__legend-dot productivity-rhythm-card__legend-dot--neutral" /><span>{t("activity.productivity.neutral")}</span></span>
              </div>
            </div>
            <div className="productivity-rhythm-card__grid">
              <div className="productivity-rhythm-card__times">
                <span />
                {RHYTHM_HOURS.map((hour) => <span key={hour}><SkeletonText>00</SkeletonText></span>)}
              </div>
              <div className="productivity-rhythm-card__body">
                <div className="productivity-rhythm-card__weekdays">
                  {WEEKDAYS.map((index) => <span className="productivity-rhythm-card__weekday" key={index}><SkeletonText>M</SkeletonText></span>)}
                </div>
                <div className="productivity-rhythm-card__board">
                  {RHYTHM_CELLS.map((index) => <span className="productivity-rhythm-card__cell" key={index} />)}
                </div>
              </div>
            </div>
          </section>

          <div className="insight-grid productivity-insight-groups">
            {sourceGroups.map(({ kind, lists }) => (
              <section className={`editorial-panel editorial-panel--soft insight-section productivity-insight-group productivity-insight-group--${kind}`} key={kind}>
                <section className="editorial-panel editorial-panel--soft insight-section trend-topics-card productivity-insight-group__section">
                  <div className="trend-topics-card__columns">
                    {lists.map((listLabel) => (
                      <div className="drift-time-trend__sources" key={listLabel}>
                        <div className="insight-source-heading">
                          <span className="label-mono drift-time-trend__sources-label">{t(listLabel)}</span>
                        </div>
                        <div className="drift-time-trend__sources-items">
                          {SOURCE_ROWS.map((row) => (
                            <div className="drift-time-trend__sources-item drift-time-trend__sources-item--app" key={row}>
                              <span className="drift-time-trend__sources-rank"><SkeletonText>0</SkeletonText></span>
                              <span className="drift-time-trend__sources-icon drift-time-trend__sources-icon--loading" />
                              <span className="drift-time-trend__sources-name"><SkeletonText>Application</SkeletonText></span>
                              <strong className="drift-time-trend__sources-value"><SkeletonText>0h 00m</SkeletonText></strong>
                              <span className="drift-source-bar drift-source-bar--loading" />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </section>
            ))}
          </div>
        </div>

        <div className="insights-stacked__breakdown">
          <div className="insights-row--weekly-categories insights-row--weekly-categories--all">
            <section className="editorial-panel editorial-panel--soft insight-section productivity-insight-groups__weekly-trend weekly-productivity-trend-card">
              <div className="weekly-productivity-trend-card__head">
                <div className="wt-toggle">
                  <span className={`wt-toggle-btn${weeklyChartMode === "productivity" ? " is-active" : ""}`}>{t("common.productivity")}</span>
                  <span className={`wt-toggle-btn${weeklyChartMode === "category" ? " is-active" : ""}`}>{t("common.category")}</span>
                  {projectModeAvailable ? <span className={`wt-toggle-btn${weeklyChartMode === "project" ? " is-active" : ""}`}>{t("common.project")}</span> : null}
                </div>
              </div>
              <WeekChartPlotLoading />
            </section>
            <section className="editorial-panel editorial-panel--soft insight-section od-cat-rebuilt weekly-summary-rail weekly-breakdown-analytical is-linked">
              <div className="weekly-summary-rail__stack weekly-breakdown-analytical__stack">
                <RingPanelLoading title={t("trends.overallProductivity")} />
                <CategoryPanelLoading title={t("common.category")} rows={5} />
              </div>
            </section>
          </div>

          <section className="focus-calendar editorial-panel editorial-panel--soft insight-section" data-calendar-variant="half">
            <div className="focus-calendar__head">
              <h2 className="label-mono insight-section__label">{t("trends.calendar.title")}</h2>
              <span>{t("trends.calendar.recentMonths", { count: "5" })}</span>
            </div>
            {/* The calendar card's own loading state takes this same height. */}
            <div className="deferred-tab-skeleton__block deferred-tab-skeleton__block--calendar" />
          </section>
        </div>
      </div>
    </div>
  );
}
