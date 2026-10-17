import { isAdditionalDisplayLanguage, supplementalText } from "../localization/supplementalCopy";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { EmptyState } from "../../components/EmptyState";
import type { WeeklyChartMode, WeeklyChartSegment, WeeklyChartView } from "./insightData";
import { useLocalization } from "../localization/LocalizationContext";
import { localeForDisplayLanguage } from "../../lib/formatting";

type WeeklyTrendChartProps = {
  readonly chart: WeeklyChartView;
  readonly segmentLabel?: (key: string) => string;
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
  segmentLabel,
  hasData,
  mode,
  projectModeAvailable = false,
  onHideSegmentHover,
  onModeChange,
  onMoveSegmentHover,
  onShowSegmentHover,
}: WeeklyTrendChartProps) {
  const { effectiveLanguage, t } = useLocalization();
  const keyboardHelpId = useId();
  type Intent = { segment: WeeklyChartSegment; weekdayIndex: number; total: number; x: number; y: number };
  const pointer = useRef<Intent | null>(null);
  const focused = useRef<Intent | null>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const [activeId, setActiveId] = useState<string | null>(null);
  const cells = chart.columns.flatMap((column, index) => column.off ? [] : column.segments.map((segment) => `${index}:${segment.key}`));
  const tabId = activeId && cells.includes(activeId) ? activeId : cells[0];
  const hideRef = useRef(onHideSegmentHover);
  hideRef.current = onHideSegmentHover;
  useEffect(() => {
    pointer.current = null;
    focused.current = null;
    hideRef.current();
  }, [chart, mode]);
  function presentIntent() {
    const intent = focused.current ?? pointer.current;
    if (intent) onShowSegmentHover(intent.segment, intent.weekdayIndex, intent.total, intent.x, intent.y);
    else onHideSegmentHover();
  }
  function navigate(event: KeyboardEvent<HTMLDivElement>, id: string) {
    const index = cells.indexOf(id);
    const next = event.key === "Home" ? 0 : event.key === "End" ? cells.length - 1
      : ["ArrowRight", "ArrowDown"].includes(event.key) ? Math.min(index + 1, cells.length - 1)
      : ["ArrowLeft", "ArrowUp"].includes(event.key) ? Math.max(index - 1, 0) : -1;
    if (next < 0) return;
    event.preventDefault();
    nodes.current.get(cells[next])?.focus();
  }
  const koreanWeekdays = ["월", "화", "수", "목", "금", "토", "일"] as const;
  const spanishWeekdays = ["L", "M", "X", "J", "V", "S", "D"] as const;
  const additionalLanguage = isAdditionalDisplayLanguage(effectiveLanguage);
  const locale = localeForDisplayLanguage(effectiveLanguage);
  // Weekday indices start on Monday; 1 January 2024 was a Monday.
  const weekday = (index: number, fallback: string) => additionalLanguage
    ? new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(2024, 0, 1 + index, 12))
    : fallback;
  const minutes = (seconds: number) => additionalLanguage
    ? new Intl.NumberFormat(locale, { style: "unit", unit: "minute", unitDisplay: "short" }).format(Math.round(seconds / 60))
    : `${Math.round(seconds / 60)}${effectiveLanguage === "ko" ? "분" : " min"}`;
  const gridlineLabel = (label: string) => additionalLanguage && /^\d+(?:\.\d+)?h$/u.test(label)
    ? new Intl.NumberFormat(locale, { style: "unit", unit: "hour", unitDisplay: "short", maximumFractionDigits: 1 }).format(Number(label.slice(0, -1)))
    : label;
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
          <span id={keyboardHelpId} className="sr-only">{(isAdditionalDisplayLanguage(effectiveLanguage) ? supplementalText(effectiveLanguage, "Use arrow keys to move between segments; Home and End move to the first and last segment.") : effectiveLanguage === "ko" ? "방향키로 구간 이동. Home과 End로 처음과 마지막 구간 이동." : "Use arrow keys to move between segments; Home and End move to the first and last segment.")}</span>
          <div className="wt-grid">
            {chart.gridlines.map((line) => (
              <div className="wt-gridline" style={{ top: `${line.topPct}%` }} key={`gl-${line.label}-${line.topPct}`}><span className="wt-gridlabel">{gridlineLabel(line.label)}</span></div>
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
                          ref={(node) => { const id = `${index}:${segment.key}`; if (node) nodes.current.set(id, node); else nodes.current.delete(id); }}
                          tabIndex={tabId === `${index}:${segment.key}` ? 0 : -1}
                          role="img"
                          aria-label={`${weekday(column.weekdayIndex, effectiveLanguage === "ko" ? koreanWeekdays[column.weekdayIndex] : column.weekday)} · ${segmentLabel?.(segment.key) ?? segment.key} · ${minutes(segment.seconds)} · ${Math.round(segment.seconds / Math.max(column.totalSeconds, 1) * 100)}%`}
                          aria-describedby={keyboardHelpId}
                          onKeyDown={(event) => navigate(event, `${index}:${segment.key}`)}
                          onFocus={(event) => {
                            setActiveId(`${index}:${segment.key}`);
                            const rect = event.currentTarget.getBoundingClientRect();
                            focused.current = { segment, weekdayIndex: column.weekdayIndex, total: column.totalSeconds, x: rect.right, y: rect.top + rect.height / 2 };
                            presentIntent();
                          }}
                          onBlur={() => { focused.current = null; presentIntent(); }}
                          onMouseEnter={(event) => {
                            pointer.current = { segment, weekdayIndex: column.weekdayIndex, total: column.totalSeconds, x: event.clientX, y: event.clientY };
                            presentIntent();
                          }}
                          onMouseMove={(event) => {
                            if (pointer.current) { pointer.current.x = event.clientX; pointer.current.y = event.clientY; }
                            if (!focused.current) onMoveSegmentHover(event.clientX, event.clientY);
                          }}
                          onMouseLeave={() => { pointer.current = null; presentIntent(); }}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <div className="wt-daylabel">{weekday(column.weekdayIndex, effectiveLanguage === "ko" ? koreanWeekdays[column.weekdayIndex] : effectiveLanguage === "es" ? spanishWeekdays[column.weekdayIndex] : column.weekday)}</div>
              </div>
            ))}
          </div>
        </div>
      ) : <EmptyState title={t("trends.noWeeklyTrend")} detail={t("trends.noWeeklyTrendDetail")} />}
    </section>
  );
}
