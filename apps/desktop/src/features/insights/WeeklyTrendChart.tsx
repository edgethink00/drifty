import type { MouseEvent } from "react";
import { EmptyState } from "../../components/EmptyState";
import type { WeeklyChartMode, WeeklyChartSegment, WeeklyChartView } from "./insightData";
import { useLocalization } from "../localization/LocalizationContext";

type WeeklyTrendChartProps = {
  readonly chart: WeeklyChartView;
  readonly hasData: boolean;
  readonly mode: WeeklyChartMode;
  readonly projectModeAvailable?: boolean;
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
  projectModeAvailable = false,
  onHideSegmentHover,
  onModeChange,
  onMoveSegmentHover,
  onShowSegmentHover,
}: WeeklyTrendChartProps) {
  const { effectiveLanguage, t } = useLocalization();
  const koreanWeekdays = ["월", "화", "수", "목", "금", "토", "일"] as const;
  return (
    <section className="editorial-panel editorial-panel--soft insight-section productivity-insight-groups__weekly-trend weekly-productivity-trend-card" aria-label={t("trends.weeklyTrendAria")}>
      <div className="weekly-productivity-trend-card__head">
        <div className="wt-toggle" role="group" aria-label={t("trends.breakdownModeAria")}>
          <button type="button" className={`wt-toggle-btn${mode === "productivity" ? " is-active" : ""}`} data-mode="productivity" aria-pressed={mode === "productivity"} onClick={() => onModeChange("productivity")}>{t("common.productivity")}</button>
          <button type="button" className={`wt-toggle-btn${mode === "category" ? " is-active" : ""}`} data-mode="category" aria-pressed={mode === "category"} onClick={() => onModeChange("category")}>{t("common.category")}</button>
          {projectModeAvailable ? (
            <button type="button" className={`wt-toggle-btn${mode === "project" ? " is-active" : ""}`} data-mode="project" aria-pressed={mode === "project"} onClick={() => onModeChange("project")}>{t("common.project")}</button>
          ) : null}
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
                <div className="wt-daylabel">{effectiveLanguage === "ko" ? koreanWeekdays[column.weekdayIndex] : column.weekday}</div>
              </div>
            ))}
          </div>
        </div>
      ) : <EmptyState title={t("trends.noWeeklyTrend")} detail={t("trends.noWeeklyTrendDetail")} />}
    </section>
  );
}
