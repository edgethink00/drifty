import { buildMonthV2Overview } from "./monthOverview";
import type { MonthCellStyle } from "./monthOverview";
import { CATEGORY_COLORS, PRODUCTIVITY_COLORS, categoryLabel, productivityLabel } from "../../lib/activityLabels";
import { WEEKDAY_LABELS, formatCompactDurationFromSeconds, formatDayLabel, formatDuration } from "../../lib/formatting";
import type { ActivitySegment, ClassificationOptions } from "@drifty/domain";

export function HistoryCalendarPanel({
  segments,
  selectedDay,
  classificationOptions,
  startOfDayMinutes,
  onSelectDay,
}: {
  segments: ActivitySegment[];
  selectedDay: string;
  classificationOptions: ClassificationOptions;
  startOfDayMinutes: number;
  onSelectDay: (day: string) => void;
}) {
  const overview = buildMonthV2Overview(segments, selectedDay, classificationOptions, startOfDayMinutes);

  return (
    <section className="month-v2" aria-label="Month focus overview">
      <div className="month-v2-story" aria-label="Month focus summary">
        <div>
          <span className="label-mono">{overview.monthLabel} · focus</span>
          <strong>{overview.totalFocusSeconds > 0 ? formatDuration(overview.totalFocusSeconds) : "0m"}</strong>
        </div>
        <div className="month-v2-story__notes">
          <span><strong>{overview.activeDays}</strong> active days</span>
          <span><strong>{overview.focusDays}</strong> focus days</span>
          <span>Longest streak: <strong>{overview.streakDays}d</strong></span>
          {overview.bestDay ? <span>Best day: <strong>{formatDayLabel(overview.bestDay.isoDay)}</strong> · {formatCompactDurationFromSeconds(overview.bestDay.focusSeconds)}</span> : null}
        </div>
      </div>

      <div className="month-v2-grid">
        <div className="month-v2-top-row">
          <section className="month-v2-calendar editorial-panel editorial-panel--soft" aria-label={`${overview.monthLabel} calendar-first focus pattern`}>
            <div className="month-v2-calendar__head">
              <span className="label-mono">Month pattern</span>
              <strong>{overview.monthLabel}</strong>
              <span className="month-v2-calendar__legend" aria-label="Less to more focus">
                <span className="month-v2-legend-ramp" aria-hidden="true">
                  {[15, 40, 70, 100].map((amount) => <span className="month-v2-legend-dot" key={amount} style={{ background: `color-mix(in srgb, var(--accent) ${amount}%, var(--bg-2))` }} />)}
                </span>
              </span>
            </div>
            <div className="month-v2-calendar__weekdays" aria-hidden="true">
              {WEEKDAY_LABELS.map((label, index) => <span className={index === 0 || index === 6 ? "is-weekend" : undefined} key={label}>{label}</span>)}
            </div>
            <div className="month-v2-calendar__grid">
              {overview.weeks.map((week) => week.map((cell) => {
                if (cell.isBlank) return <span className="month-v2-cell month-v2-cell--blank" key={cell.id} />;
                if (cell.isFuture) {
                  return (
                    <span className="month-v2-cell month-v2-cell--future" key={cell.id}>
                      <span className="month-v2-cell__num">{cell.dayNumber}</span>
                    </span>
                  );
                }

                const hasActivity = cell.totalSeconds > 0;
                const intensity = overview.peakActivitySeconds > 0 ? cell.totalSeconds / overview.peakActivitySeconds : 0;
                const heatPercent = Math.round(12 + Math.pow(intensity, 0.68) * 80);
                const weekday = new Date(`${cell.isoDay}T12:00:00`).getDay();
                const isWeekend = weekday === 0 || weekday === 6;
                const cellStyle: MonthCellStyle | undefined = hasActivity ? {
                  "--activity-tone": `color-mix(in srgb, var(--accent) ${heatPercent}%, var(--bg-2))`,
                  "--activity-border": `color-mix(in srgb, var(--accent) ${Math.min(heatPercent + 8, 96)}%, var(--line))`,
                  "--activity-ink": intensity > 0.54 ? "var(--canvas)" : "var(--text)",
                } : undefined;

                return (
                  <button
                    className={`month-v2-cell${hasActivity ? "" : " month-v2-cell--idle"}${cell.isToday ? " month-v2-cell--today" : ""}${cell.isSelected ? " month-v2-cell--selected" : ""}${isWeekend ? " month-v2-cell--weekend" : ""}`}
                    key={cell.id}
                    onClick={() => onSelectDay(cell.isoDay)}
                    style={cellStyle}
                    title={hasActivity ? `${formatDayLabel(cell.isoDay)} · ${formatCompactDurationFromSeconds(cell.totalSeconds)} tracked${cell.focusSeconds > 0 ? ` · ${formatCompactDurationFromSeconds(cell.focusSeconds)} focus` : ""}${cell.driftSeconds > 0 ? ` · ${formatCompactDurationFromSeconds(cell.driftSeconds)} drift` : ""}` : `${formatDayLabel(cell.isoDay)} · no activity`}
                    type="button"
                  >
                    {cell.isToday ? <span className="month-v2-cell__today-badge">NOW</span> : null}
                    <span className="month-v2-cell__num">{cell.dayNumber}</span>
                    {hasActivity ? <span className="month-v2-cell__val">{formatCompactDurationFromSeconds(cell.totalSeconds)}</span> : <span className="month-v2-cell__dash">—</span>}
                    {cell.driftSeconds > 0 && cell.focusSeconds === 0 ? <span className="month-v2-cell__drift-dot" aria-label="drift only" /> : null}
                  </button>
                );
              }))}
            </div>
          </section>

          <aside className="month-v2-side month-v2-side--top" aria-label="Month primary context">
            <section className="editorial-panel editorial-panel--soft month-v2-side-card month-v2-side-card--category">
              <div className="month-v2-card-head">
                <span className="label-mono">Category mix</span>
                <strong>{overview.categoryEntries[0] ? categoryLabel(overview.categoryEntries[0].category) : "No activity"}</strong>
              </div>
              <div className="month-v2-metric-list">
                {overview.categoryEntries.length > 0 ? overview.categoryEntries.map((entry) => (
                  <div className="month-v2-metric-row" key={entry.category}>
                    <div className="month-v2-metric-row__head">
                      <span className={`category-dot category-dot--${entry.category}`} aria-hidden="true" />
                      <span>{categoryLabel(entry.category)}</span>
                      <strong>{formatCompactDurationFromSeconds(entry.totalSeconds)}</strong>
                    </div>
                    <div className="month-v2-metric-track" aria-hidden="true">
                      <span style={{ width: `${Math.max(entry.ratio * 100, 2)}%`, background: CATEGORY_COLORS[entry.category] }} />
                    </div>
                    <small>{Math.round(entry.ratio * 100)}% of tracked month</small>
                  </div>
                )) : <p className="month-v2-empty-note">No tracked category time yet.</p>}
              </div>
            </section>
          </aside>
        </div>

        <div className="month-v2-bottom" aria-label="Month supporting metrics">
          <section className="editorial-panel editorial-panel--soft month-v2-side-card">
            <div className="month-v2-card-head">
              <span className="label-mono">Productivity split</span>
              <strong>{overview.primaryProductivity ? productivityLabel(overview.primaryProductivity.productivity) : "No data"}</strong>
            </div>
            <div className="month-v2-split-bar" aria-label="Productivity split">
              {overview.productivityEntries.map((entry) => (
                <span key={entry.productivity} style={{ width: `${Math.max(entry.ratio * 100, entry.totalSeconds > 0 ? 2 : 0)}%`, background: PRODUCTIVITY_COLORS[entry.productivity] }} title={`${productivityLabel(entry.productivity)} · ${formatCompactDurationFromSeconds(entry.totalSeconds)}`} />
              ))}
            </div>
            <div className="month-v2-productivity-list">
              {overview.productivityEntries.map((entry) => (
                <div className="month-v2-productivity-item" key={entry.productivity}>
                  <span style={{ background: PRODUCTIVITY_COLORS[entry.productivity] }} aria-hidden="true" />
                  <strong>{productivityLabel(entry.productivity)}</strong>
                  <small>{formatCompactDurationFromSeconds(entry.totalSeconds)} · {Math.round(entry.ratio * 100)}%</small>
                </div>
              ))}
            </div>
          </section>

          <section className="editorial-panel editorial-panel--soft month-v2-side-card month-v2-side-card--rhythm">
            <div className="month-v2-card-head">
              <span className="label-mono">Rhythm</span>
              <strong>{overview.activeDays} active days</strong>
            </div>
            <div className="month-v2-stat">
              <div><span className="label-mono">Avg focus</span><strong>{formatCompactDurationFromSeconds(overview.averageFocusPerActiveDay)}</strong><small>per active day</small></div>
              <div><span className="label-mono">Longest streak</span><strong>{overview.streakDays}d</strong><small>consecutive focus</small></div>
              <div><span className="label-mono">Drift total</span><strong>{formatCompactDurationFromSeconds(overview.totalDriftSeconds)}</strong><small>across month</small></div>
            </div>
            <div className="month-v2-weekday-chart" aria-label="Average focus by weekday">
              {WEEKDAY_LABELS.map((label, index) => {
                const average = overview.weekdayFocusAverages[index] ?? 0;
                const height = overview.maxWeekdayFocusAverage > 0 ? (average / overview.maxWeekdayFocusAverage) * 100 : 0;
                return (
                  <div className={`month-v2-weekday-bar${index === 0 || index === 6 ? " is-weekend" : ""}`} key={label}>
                    <div className="month-v2-weekday-bar__fill" style={{ height: `${height}%` }} />
                    <span className="month-v2-weekday-bar__label">{label}</span>
                    <span className="month-v2-weekday-bar__val">{average > 0 ? formatCompactDurationFromSeconds(average) : "—"}</span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
