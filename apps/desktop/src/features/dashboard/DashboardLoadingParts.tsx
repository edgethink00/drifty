import { useLocalization } from "../localization/LocalizationContext";

/**
 * Placeholder text that keeps the real text's line box. The words are
 * transparent and only size the box; a rounded sheen bar sits over them, so a
 * loading block is exactly as tall as the loaded one it stands in for.
 */
export function SkeletonText({ children }: { readonly children: string }) {
  return <span className="loading-skeleton-text" aria-hidden="true">{children}</span>;
}

// The default category legend: focus, neutral and drift groups with their dots.
const LEGEND_GROUPS = [
  { label: "activity.productivity.focus", dots: 2 },
  { label: "activity.productivity.neutral", dots: 3 },
  { label: "activity.productivity.drift", dots: 4 },
] as const;

/**
 * The flow legend while the day or week loads: the legend's own pills and dots
 * in its own container, with the label and colors still to come. The pencil
 * keeps its place at the end. The color switch and time zoom beside it stay
 * live, because they are preferences rather than data.
 */
export function FlowLegendLoading() {
  const { t } = useLocalization();
  return (
    <div className="flow-chart-legend flow-chart-legend--loading" aria-hidden="true">
      {LEGEND_GROUPS.map(({ label, dots }) => (
        <span className="flow-chart-legend__group" key={label}>
          {/* The group's own word, hidden under the sheen, gives the pill its loaded size. */}
          <span className="flow-chart-legend__parent"><SkeletonText>{t(label)}</SkeletonText></span>
          <span className="flow-chart-legend__categories">
            {Array.from({ length: dots }, (_, dotIndex) => (
              <span className="flow-chart-legend__dot flow-chart-legend__dot--loading" key={dotIndex} />
            ))}
          </span>
        </span>
      ))}
      <span className="pencil-plate pencil-plate--sm flow-chart-legend__edit flow-chart-legend__edit--loading" />
    </div>
  );
}

function LegendItemsLoading({ count }: { readonly count: number }) {
  return (
    <div className="flow-compact-split-chart__legend" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span className="flow-compact-split-chart__legend-item" key={index}>
          <span className="flow-compact-split-chart__swatch flow-compact-split-chart__swatch--loading" />
          <span className="flow-compact-split-chart__legend-label"><SkeletonText>Category</SkeletonText></span>
          <span className="flow-compact-split-chart__legend-value"><SkeletonText>0h 00m</SkeletonText></span>
        </span>
      ))}
    </div>
  );
}

// Bar heights for the weekly chart's placeholder columns.
const WEEK_CHART_BARS = [34, 48, 62, 56, 70, 44, 28] as const;

/** The productivity ring block, waiting for its totals. */
export function RingPanelLoading({ title }: { readonly title: string }) {
  return (
    <div className="flow-compact-split-chart__panel flow-compact-split-chart__panel--circle" aria-hidden="true">
      <div className="flow-compact-split-chart__head">
        <span className="label-mono">{title}</span>
        <strong><SkeletonText>0h 00m</SkeletonText></strong>
      </div>
      <div className="flow-compact-productivity-circle">
        <div className="flow-compact-productivity-circle__dial-shell">
          <svg className="flow-compact-productivity-circle__dial" viewBox="0 0 100 100" aria-hidden="true">
            <circle className="flow-compact-productivity-circle__track" cx="50" cy="50" r="40" />
          </svg>
        </div>
        <LegendItemsLoading count={3} />
      </div>
    </div>
  );
}

/** The category bar block, waiting for its totals. */
export function CategoryPanelLoading({ title, rows }: { readonly title: string; readonly rows: number }) {
  return (
    <div className="flow-compact-split-chart__panel" aria-hidden="true">
      <div className="flow-compact-split-chart__head">
        <span className="label-mono">{title}</span>
        <strong><SkeletonText>0h 00m</SkeletonText></strong>
      </div>
      <div className="flow-compact-split-chart__bar flow-compact-split-chart__bar--loading" />
      <LegendItemsLoading count={rows} />
    </div>
  );
}

/** The stacked weekly chart's plot with placeholder columns; the caller sizes it. */
export function WeekChartPlotLoading() {
  return (
    <div className="wt-plot wt-plot--loading" aria-hidden="true">
      <div className="wt-cols">
        {WEEK_CHART_BARS.map((height, index) => (
          <div className="wt-col" key={index}>
            <div className="wt-bars-zone">
              <div className="wt-bar wt-bar--loading" style={{ height: `${height}%` }} />
            </div>
            <div className="wt-daylabel"><SkeletonText>M</SkeletonText></div>
          </div>
        ))}
      </div>
    </div>
  );
}

type BreakdownLoadingRailProps = {
  /** Day or Week: Week adds the weekly chart and has four summary tiles, Day six. */
  readonly period: "day" | "week";
  /** The hours-down Day ends the rail with its most-used apps. */
  readonly showApps?: boolean;
};

/**
 * The Breakdown panel's loading contents, block for block: the productivity
 * ring, the category bar, Week's daily chart, the summary tiles and, on the
 * hours-down Day, the most-used apps. Each block uses the loaded block's own
 * classes, so the rail keeps its height and spacing when the data arrives.
 */
export function BreakdownLoadingRail({ period, showApps = false }: BreakdownLoadingRailProps) {
  const { t } = useLocalization();
  const tileCount = period === "week" ? 4 : 6;
  // A week nearly always fills the bar's five rows; a day usually shows about four.
  const categoryRows = period === "week" ? 5 : 4;
  return (
    <>
      <RingPanelLoading title={t(period === "week" ? "common.productivity" : "dashboard.today.productivity")} />
      <CategoryPanelLoading title={t("dashboard.today.categories")} rows={categoryRows} />
      {period === "week" ? (
        <section className="week-v2-side-card week-v2-side-card--weekly-breakdown" aria-hidden="true">
          <span className="label-mono">{t("dashboard.week.weeklyBreakdown")}</span>
          <WeekChartPlotLoading />
        </section>
      ) : null}
      <div className="kpi-row kpi-row--insights insight-summary" aria-hidden="true">
        {Array.from({ length: tileCount }, (_, index) => (
          <div className="metric-tile insight-summary__tile" key={index}>
            <span className="eyebrow"><SkeletonText>Tracked</SkeletonText></span>
            <strong><SkeletonText>0h 00m</SkeletonText></strong>
            <p><SkeletonText>Average 00m</SkeletonText></p>
          </div>
        ))}
      </div>
      {showApps ? (
        <section className="week-v2-side-card your-day-usage" aria-hidden="true">
          <div className="flow-compact-split-chart__head">
            <span className="label-mono">{t("dashboard.today.apps")}</span>
            <strong><SkeletonText>0h 00m</SkeletonText></strong>
          </div>
          <ol className="your-day-usage__list">
            {Array.from({ length: 5 }, (_, index) => (
              <li key={index}>
                <span className="your-day-usage__icon"><span className="your-day-usage__icon-loading" /></span>
                <span className="your-day-usage__name"><SkeletonText>Application</SkeletonText></span>
                <span className="your-day-usage__duration"><SkeletonText>0h 00m</SkeletonText></span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}
