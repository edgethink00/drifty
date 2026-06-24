import type { MouseEvent } from "react";
import { EmptyState } from "../../components/EmptyState";
import type { WeeklyChartMode, WeeklyChartSegment, WeeklyChartView } from "./insightData";

type WeeklyTrendChartProps = {
  readonly chart: WeeklyChartView;
  readonly hasData: boolean;
  readonly mode: WeeklyChartMode;
  readonly onHideSegmentHover: () => void;
  readonly onModeChange: (mode: WeeklyChartMode) => void;
  readonly onMoveSegmentHover: (x: number, y: number) => void;
  readonly onShowSegmentHover: (
    segment: WeeklyChartSegment,
    weekdayIndex: number,
    columnSeconds: number,
    x: number,
    y: number,
  ) => void;
};

export function WeeklyTrendChart({
  chart,
  hasData,
  mode,
  onHideSegmentHover,
  onModeChange,
  onMoveSegmentHover,
  onShowSegmentHover,
}: WeeklyTrendChartProps) {
  return (
    <section className="editorial-panel editorial-panel--soft insight-section productivity-insight-groups__weekly-trend weekly-productivity-trend-card" aria-label="Weekly focus and drift trend">
      <div className="weekly-productivity-trend-card__head">
        <div><span className="label-mono insight-section__label">Weekly Breakdown</span></div>
        <div className="wt-toggle" role="tablist">
          <button type="button" className={`wt-toggle-btn${mode === "productivity" ? " is-active" : ""}`} data-mode="productivity" onClick={() => onModeChange("productivity")}>Productivity</button>
          <button type="button" className={`wt-toggle-btn${mode === "category" ? " is-active" : ""}`} data-mode="category" onClick={() => onModeChange("category")}>Category</button>
        </div>
      </div>
      {hasData ? (
        <div className="wt-plot">
          <div className="wt-grid">
            {chart.gridlines.map((line) => (
              <div className="wt-gridline" style={{ top: `${line.topPct}%` }} key={`gl-${line.label}-${line.topPct}`}><span className="wt-gridlabel">{line.label}</span></div>
            ))}
            {[14.2857, 28.5714, 42.8571, 57.1429, 71.4286, 85.7143].map((left) => (
              <div className="wt-vline" style={{ left: `${left}%` }} key={`vl-${left}`} />
            ))}
          </div>
          <div className="wt-cols">
            {chart.columns.map((column, index) => (
              <div className={`wt-col${column.off ? " wt-col--off" : ""}`} key={`${column.weekday}-${index}`}>
                <div className="wt-bars-zone">
                  {column.off ? null : (
                    <div className="wt-bar" style={{ height: `${column.barHeightPct}%` }}>
                      {column.segments.map((segment) => (
                        <div
                          className="wt-seg"
                          style={{ height: `${segment.heightPct}%`, background: segment.color }}
                          key={segment.key}
                          onMouseEnter={(event: MouseEvent<HTMLDivElement>) => onShowSegmentHover(segment, column.weekdayIndex, column.totalSeconds, event.clientX, event.clientY)}
                          onMouseMove={(event: MouseEvent<HTMLDivElement>) => onMoveSegmentHover(event.clientX, event.clientY)}
                          onMouseLeave={onHideSegmentHover}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <div className="wt-daylabel">{column.weekday}</div>
              </div>
            ))}
          </div>
        </div>
      ) : <EmptyState title="No weekly trend yet" detail="Weekly focus and drift totals appear after activity is recorded." />}
    </section>
  );
}
