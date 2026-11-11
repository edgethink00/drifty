import { useActivityInspection } from "../dashboard/ActivityInspectionContext";
import { isAdditionalDisplayLanguage, supplementalText } from "../localization/supplementalCopy";
import { memo, useId, useMemo, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { logicalMinuteOfDay, type FlowBlock, type FlowIntervalMinutes } from "@drifty/domain";
import type { FlowColorMode } from "./FlowChartTypes";
import { clockHourForLogicalHour, formatLocalizedCalendarMinuteLabel, formatLocalizedCompactDurationFromSeconds, formatLocalizedCompactHourLabel } from "../../lib/formatting";
import { buildCellGroupAriaLabels, formatHourLabel, minuteOfDayForCell } from "./flowChartFormat";
import type { FlowBlockHoverGroup } from "./flowHoverGroups";
import { NO_PROJECT_COLOR } from "./projectFlowView";
import { useLocalization } from "../localization/LocalizationContext";
import { localizedCategoryLabel, localizedProductivityLabel } from "../localization/activityTranslations";
import { levelFor } from "../productivity-levels/productivityLevelView";
import { useProductivityLevels } from "../settings/categoryCustomizationStore";
import type { PhoneFlowCell } from "../phone-time/phoneFlowCells";
import { phoneTimeDurationLabel, phoneTimeRangeLabel } from "../phone-time/phoneTimeFormat";
import { buildFlowTimeRows, type FlowCellSlice } from "./flowChartRows";
import { FlowChartScrollArea, type FlowChartScrollScale } from "./FlowChartScrollArea";

type FlowProjectCellStyle = CSSProperties & Record<"--flow-project-color", string>;
type FlowMinuteLabelStyle = CSSProperties & Record<"--flow-minute", number>;
type FlowNowMarkerStyle = CSSProperties & Record<"--flow-now-offset", string>;

/** Hours across or time down, with configurable display rows. */
export type FlowChartOrientation = "hoursAcross" | "hoursDown";

/** Hours-down only: the column at the right end of the rows. `render` fills
 *  it row by row; `overlay` draws once across every row (a lane of blocks). */
export type FlowChartRowAside = {
  readonly header?: ReactNode;
  readonly render?: (logicalHour: number, clockHour: number) => ReactNode;
  readonly overlay?: ReactNode;
  /** A note in the aside column at the current-time line. While nothing is
   *  being recorded the line itself turns dashed. */
  readonly now?: { readonly note: ReactNode; readonly recording: "off" | "unknown" | null };
};

export type FlowChartReadOnlyPreview = {
  readonly idsByCell: ReadonlyMap<number, string>;
  readonly ariaLabelsById: ReadonlyMap<string, string>;
  /** Opt-in roving tab stop; the caller owns arrow-key navigation. */
  readonly tabStopId?: string;
};

type FlowChartGridProps = {
  readonly classifiedResultIds?: ReadonlySet<string>;
  readonly blockByCell: ReadonlyMap<string, FlowBlock>;
  readonly boundaryMinutes: number;
  readonly colorMode: FlowColorMode;
  readonly currentHourIndex: number | null;
  readonly currentMinuteOffset: number | null;
  /** Hours down: the current minute of the logical day, for the time marker across the rows. */
  readonly currentLogicalMinute?: number | null;
  readonly hoverGroupsByCell: ReadonlyMap<number, FlowBlockHoverGroup>;
  readonly intervalMinutes: FlowIntervalMinutes;
  readonly setFlowGridElement: (element: HTMLDivElement | null) => void;
  readonly onOpenActivity?: (group: FlowBlockHoverGroup, target: HTMLButtonElement) => void;
  readonly inspectedGroup?: FlowBlockHoverGroup | null;
  /**
   * Dashboard-only cells stay pointer-readable without pretending to open an
   * editor. One focusable image represents each visual group; the remaining
   * painted cells are hidden from the accessibility tree.
   */
  readonly readOnlyPreview?: FlowChartReadOnlyPreview;
  readonly orientation?: FlowChartOrientation;
  readonly rowAside?: FlowChartRowAside;
  /** Keep the minute axis outside the scrolling time rows. */
  readonly scrollScale?: FlowChartScrollScale;
  /**
   * Approximate iPhone time drawn only in cells the Mac left empty. These
   * cells are not activity: they open nothing and only describe themselves.
   */
  readonly phoneCellsByMinute?: ReadonlyMap<number, PhoneFlowCell>;
};

type FlowCurrentHourStyle = CSSProperties & Record<"--flow-current-hour", number>;

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
/** Hours down draws one row per hour, labelled every ten minutes above the cells. */
const ROW_MINUTES = 60;
const MINUTE_LABELS = Array.from({ length: ROW_MINUTES / 10 }, (_, index) => index * 10);

// Memoized so pointer-driven hover (owned by FlowHoverLayer) never re-renders the grid's
// hundreds of cells. All props are referentially stable across a hover: the maps are
// memoized upstream and the hour/minute markers change only on the wall-clock tick.
export const FlowChartGrid = memo(function FlowChartGrid({
  classifiedResultIds,
  blockByCell,
  boundaryMinutes,
  colorMode,
  currentHourIndex,
  currentMinuteOffset,
  currentLogicalMinute = null,
  hoverGroupsByCell,
  intervalMinutes,
  setFlowGridElement,
  onOpenActivity,
  inspectedGroup = null,
  readOnlyPreview,
  orientation = "hoursAcross",
  rowAside,
  scrollScale,
  phoneCellsByMinute,
}: FlowChartGridProps) {
  const inspection = useActivityInspection();
  const hoursDown = orientation === "hoursDown";
  const timeRows = useMemo(() => buildFlowTimeRows(ROW_MINUTES, intervalMinutes), [intervalMinutes]);
  const productivityLevels = useProductivityLevels();
  const { effectiveLanguage, t } = useLocalization();
  const rowMinuteOffsets = useMemo(
    () => Array.from({ length: 60 / intervalMinutes }, (_, index) => index * intervalMinutes),
    [intervalMinutes],
  );
  const cellAriaLabelsByMinute = useMemo(() => buildCellGroupAriaLabels(hoverGroupsByCell, {
    categoryLabel: ({ category }) => localizedCategoryLabel(category, t),
    productivityLabel: ({ category, productivity }) => levelFor(category, productivity, productivityLevels)?.name ?? localizedProductivityLabel(productivity, t),
    durationLabel: (seconds) => formatLocalizedCompactDurationFromSeconds(seconds, effectiveLanguage),
    timeBlockPrefix: (isAdditionalDisplayLanguage(effectiveLanguage) ? supplementalText(effectiveLanguage, "Time block") : effectiveLanguage === "ko" ? "시간대" : effectiveLanguage === "es" ? "Franja horaria" : "Time block"),
    durationPrefix: (isAdditionalDisplayLanguage(effectiveLanguage) ? supplementalText(effectiveLanguage, "Duration") : effectiveLanguage === "ko" ? "소요 시간" : effectiveLanguage === "es" ? "Duración" : "Duration"),
  }), [effectiveLanguage, hoverGroupsByCell, productivityLevels, t]);
  const phoneCellAriaLabels = useMemo(() => {
    const labels = new Map<number, string>();
    for (const cell of phoneCellsByMinute?.values() ?? []) {
      if (!cell.isFirstOfBlock) continue;
      labels.set(cell.minuteOfDay, t("dashboard.today.phoneTimeCell", {
        label: cell.block.label.trim() || t("dashboard.today.phoneTimeDefaultGroup"),
        range: phoneTimeRangeLabel(cell.block, effectiveLanguage),
        duration: phoneTimeDurationLabel(cell.block, effectiveLanguage),
      }));
    }
    return labels;
  }, [effectiveLanguage, phoneCellsByMinute, t]);
  // The grid is one tab stop: only one cell is in the tab order and the arrow
  // keys move between cells, so the controls after the chart are one Tab away
  // instead of a hundred. It starts on the day's earliest cell.
  const firstCellMinute = useMemo(() => {
    for (const hour of HOURS) {
      for (const minuteOffset of rowMinuteOffsets) {
        const minuteOfDay = minuteOfDayForCell(hour, minuteOffset, boundaryMinutes);
        if (blockByCell.has(`${minuteOfDay}`)) return minuteOfDay;
      }
    }
    return null;
  }, [blockByCell, boundaryMinutes, rowMinuteOffsets]);
  const [rovingMinute, setRovingMinute] = useState<number | null>(null);
  // Announced once on the cell Tab lands on, until the arrow keys are used.
  const keyboardHintId = useId();
  const [arrowKeysUsed, setArrowKeysUsed] = useState(false);
  const tabStopMinute = rovingMinute !== null && blockByCell.has(`${rovingMinute}`) ? rovingMinute : firstCellMinute;
  const moveCellFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = event.target instanceof HTMLButtonElement && event.target.classList.contains("flow-cell") ? event.target : null;
    if (!current) return;
    const cells = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button.flow-cell"));
    const position = (cell: HTMLButtonElement) => [Number(cell.dataset.flowHour), Number(cell.dataset.flowOffset)] as const;
    const [hour, offset] = position(current);
    const chronological = [...cells].sort((left, right) => {
      const [leftHour, leftOffset] = position(left);
      const [rightHour, rightOffset] = position(right);
      return leftHour - rightHour || leftOffset - rightOffset;
    });
    const nearest = (candidates: HTMLButtonElement[], distance: (cell: HTMLButtonElement) => number) => (
      candidates.reduce<HTMLButtonElement | null>((best, cell) => (best === null || distance(cell) < distance(best) ? cell : best), null)
    );
    let next: HTMLButtonElement | null = null;
    // Hours down puts the minutes across and the hours down, so the arrows swap axes.
    const key = hoursDown
      ? ({ ArrowDown: "ArrowRight", ArrowUp: "ArrowLeft", ArrowRight: "ArrowDown", ArrowLeft: "ArrowUp" } as Record<string, string>)[event.key] ?? event.key
      : event.key;
    switch (key) {
      case "ArrowDown":
        next = nearest(cells.filter((cell) => position(cell)[0] === hour && position(cell)[1] > offset), (cell) => position(cell)[1] - offset);
        break;
      case "ArrowUp":
        next = nearest(cells.filter((cell) => position(cell)[0] === hour && position(cell)[1] < offset), (cell) => offset - position(cell)[1]);
        break;
      case "ArrowRight":
        next = nearest(cells.filter((cell) => position(cell)[0] > hour), (cell) => (position(cell)[0] - hour) * 1000 + Math.abs(position(cell)[1] - offset));
        break;
      case "ArrowLeft":
        next = nearest(cells.filter((cell) => position(cell)[0] < hour), (cell) => (hour - position(cell)[0]) * 1000 + Math.abs(position(cell)[1] - offset));
        break;
      case "Home":
        next = chronological[0] ?? null;
        break;
      case "End":
        next = chronological[chronological.length - 1] ?? null;
        break;
      default:
        return;
    }
    event.preventDefault();
    setArrowKeysUsed(true);
    next?.focus();
  };
  const firstPreviewMinuteById = useMemo(() => {
    if (!readOnlyPreview) return new Map<string, number>();
    const firstById = new Map<string, number>();
    const entries = [...readOnlyPreview.idsByCell.entries()].sort((left, right) => (
      logicalMinuteOfDay(left[0], boundaryMinutes) - logicalMinuteOfDay(right[0], boundaryMinutes)
    ));
    for (const [minute, id] of entries) {
      if (!firstById.has(id)) firstById.set(id, minute);
    }
    return firstById;
  }, [boundaryMinutes, readOnlyPreview]);

  const hourLabel = (clockHour: number) => (
    effectiveLanguage === "en" ? formatHourLabel(clockHour) : effectiveLanguage === "es" ? String(clockHour) : formatLocalizedCompactHourLabel(clockHour, effectiveLanguage)
  );

  const renderCell = (hour: number, minuteOffset: number, slice?: FlowCellSlice) => {
    const minuteOfDay = minuteOfDayForCell(hour, minuteOffset, boundaryMinutes);
    const sliceStyle: CSSProperties | undefined = slice ? { gridColumn: `calc(var(--flow-cell-column-start, 2) + ${slice.columnOffset}) / span ${slice.columnSpan}` } : undefined;
    const sliceData = slice ? { "data-flow-source-minute": slice.sourceMinute, "data-flow-slice-start": slice.startMinute, "data-flow-slice-duration": slice.endMinute - slice.startMinute } : {};
    const continuation = slice !== undefined && slice.startMinute !== slice.sourceMinute;
    const block = blockByCell.get(`${minuteOfDay}`);
    const isCurrentHourCell = slice && currentLogicalMinute !== null
      ? currentLogicalMinute >= slice.startMinute && currentLogicalMinute < slice.endMinute
      : hour === currentHourIndex && minuteOffset === currentMinuteOffset;
    if (!block) {
      const phoneCell = phoneCellsByMinute?.get(minuteOfDay);
      if (phoneCell) {
      const phoneLabel = continuation ? undefined : phoneCellAriaLabels.get(minuteOfDay);
        return (
          <span
            className={`flow-cell flow-cell--phone${isCurrentHourCell ? " flow-cell--now-hour" : ""}`}
            key={minuteOfDay}
            role={phoneLabel ? "img" : undefined}
            aria-label={phoneLabel}
            aria-hidden={phoneLabel ? undefined : true}
            data-phone-minute={minuteOfDay}
            data-phone-block={phoneCell.blockIndex}
            style={sliceStyle}
            {...sliceData}
          >
            <span className="flow-cell__mark" aria-hidden="true" />
          </span>
        );
      }
      return (
        <span
          className={`flow-cell flow-cell--empty${isCurrentHourCell ? " flow-cell--now-hour" : ""}`}
          key={minuteOfDay}
          aria-hidden="true"
          style={sliceStyle}
          {...sliceData}
        />
      );
    }
    return renderBlockCell(hour, minuteOffset, block, isCurrentHourCell, slice);
  };

  if (hoursDown) {
    // Week's localized whole hours.
    const railLabel = (clockHour: number) => formatLocalizedCompactHourLabel(clockHour, effectiveLanguage);
    // The Week calendar's time marker, across the rows: a line at the current
    // minute, an arrow at its end and the time beside it.
    const nowMarker = currentLogicalMinute !== null ? (() => {
      const style: FlowNowMarkerStyle = { "--flow-now-offset": `${(currentLogicalMinute / (HOURS.length * 60)) * 100}%` };
      const label = formatLocalizedCalendarMinuteLabel("", currentLogicalMinute, effectiveLanguage, boundaryMinutes);
      const now = rowAside?.now;
      const timeLabel = t("dashboard.week.currentTime", { time: label });
      return (
        <div className="flow-chart-now-marker" style={style}
          aria-label={now?.recording === "unknown" ? `${timeLabel}. ${t("ai.recovery.recording.databaseUnavailable")}` : timeLabel}
          data-recording={now?.recording ?? undefined}>
          <span className="flow-chart-now-marker__line" aria-hidden="true" />
          <span className="flow-chart-now-marker__label">{label}</span>
          <span className="flow-chart-now-marker__cap" aria-hidden="true" />
          {now?.note != null ? (
            // In the last hour and a half the note opens upward so the day's end never clips it.
            <div className="flow-chart-now-marker__note" data-placement={currentLogicalMinute > HOURS.length * 60 - 90 ? "above" : "below"}>
              {now.note}
            </div>
          ) : null}
        </div>
      );
    })() : null;
    const rows = (
      <>
        {readOnlyPreview ? null : <span id={keyboardHintId} className="sr-only">{t("dashboard.today.flowChartKeyboardHint")}</span>}
        <div className="flow-chart-grid flow-chart-grid--hours-down" ref={setFlowGridElement} onKeyDown={readOnlyPreview ? undefined : moveCellFocus}>
          {timeRows.map((row) => {
            const hour = Math.floor(row.startMinute / 60);
            const clockHour = clockHourForLogicalHour(hour, boundaryMinutes);
            return (
              <div className="flow-chart-row flow-chart-row--hour" key={row.startMinute} data-flow-row-start={row.startMinute}>
                <div className="flow-chart-row-label"><span className="flow-chart-time-label__text">{railLabel(clockHour)}</span></div>
                {row.slices.map((slice) => renderCell(Math.floor(slice.sourceMinute / 60), slice.sourceMinute % 60, slice))}
                {rowAside ? <div className="flow-chart-row-aside">{rowAside.render?.(hour, clockHour)}</div> : null}
              </div>
            );
          })}
          <span className="flow-chart-hour-endpoint" aria-hidden="true"><span className="flow-chart-time-label__text">{railLabel(clockHourForLogicalHour(HOURS.length, boundaryMinutes))}</span></span>
          {rowAside?.overlay}
          {nowMarker}
        </div>
      </>
    );
    return (
      <>
        <div className="flow-chart-minutes" aria-hidden="true">
          <span />
          <span className="flow-chart-minutes__track">
            {MINUTE_LABELS.map((minute) => {
              const style: FlowMinuteLabelStyle = { "--flow-minute": minute };
              return <span key={minute} style={style}>{":" + `${minute}`.padStart(2, "0")}</span>;
            })}
          </span>
          {rowAside ? <span className="flow-chart-row-aside flow-chart-row-aside--head">{rowAside.header}</span> : null}
        </div>
        {scrollScale
          ? <FlowChartScrollArea scale={scrollScale} label={t("dashboard.today.flowChart", { interval: intervalMinutes })}>{rows}</FlowChartScrollArea>
          : rows}
      </>
    );
  }

  return (
    <>
      <div className="flow-chart-hours" aria-hidden="true">
        <span />
        {HOURS.map((hour) => {
          const clockHour = clockHourForLogicalHour(hour, boundaryMinutes);
          const showHourLabel = hour === currentHourIndex || (hour % 3 === 0 && !(
            effectiveLanguage === "es" && currentHourIndex !== null && Math.abs(hour - currentHourIndex) <= 1
          ));
          return (
            <span className={hour === currentHourIndex ? "flow-chart-hour--now" : undefined} key={hour}>
              {showHourLabel ? hourLabel(clockHour) : ""}
            </span>
          );
        })}
      </div>
      {readOnlyPreview ? null : <span id={keyboardHintId} className="sr-only">{t("dashboard.today.flowChartKeyboardHint")}</span>}
      <div className="flow-chart-grid" ref={setFlowGridElement} onKeyDown={readOnlyPreview ? undefined : moveCellFocus}>
        {rowMinuteOffsets.map((minuteOffset) => {
          const isCurrentMinuteRow = minuteOffset === currentMinuteOffset;
          const nearestLabelMinuteOffset = currentMinuteOffset !== null && currentMinuteOffset + intervalMinutes < 60
            ? currentMinuteOffset + intervalMinutes
            : currentMinuteOffset;
          const isCurrentTimeLabelRow = minuteOffset === nearestLabelMinuteOffset;
          const isTerminalCurrentMinuteRow = isCurrentMinuteRow && minuteOffset + intervalMinutes >= 60;
          const isTerminalCurrentHourRow = isCurrentMinuteRow && currentHourIndex === HOURS.length - 1;
          const currentHourStyle: FlowCurrentHourStyle | undefined = isCurrentMinuteRow && currentHourIndex !== null
            ? { "--flow-current-hour": currentHourIndex }
            : undefined;

          return (
            <div
              className={`flow-chart-row${isCurrentMinuteRow ? " flow-chart-row--now" : ""}${isTerminalCurrentMinuteRow ? " flow-chart-row--now-terminal" : ""}${isTerminalCurrentHourRow ? " flow-chart-row--now-terminal-hour" : ""}${isCurrentTimeLabelRow ? " flow-chart-row--time-label" : ""}`}
              key={minuteOffset}
              style={currentHourStyle}
            >
              <div className="flow-chart-row-label">:{`${minuteOffset}`.padStart(2, "0")}</div>
              {HOURS.map((hour) => renderCell(hour, minuteOffset))}
            </div>
          );
        })}
      </div>
    </>
  );

  function renderBlockCell(hour: number, minuteOffset: number, block: FlowBlock, isCurrentHourCell: boolean, slice?: FlowCellSlice) {
                const isProjectMode = colorMode === "project";
                const unclassifiedClass = !isProjectMode && block.category === "unknown"
                  ? " flow-cell--unclassified"
                  : "";
                const colorClass = isProjectMode
                  ? "flow-cell--project"
                  // An added level colors its neutral time in its own color.
                  : `flow-cell--${colorMode === "productivity" ? levelFor(block.category, block.productivity, productivityLevels)?.id ?? block.productivity : block.category}`;
                const remoteDeviceClass = block.deviceId ? " flow-cell--remote-device" : "";
                const projectStyle: FlowProjectCellStyle | undefined = isProjectMode
                  ? { "--flow-project-color": block.projectColor ?? NO_PROJECT_COLOR }
                  : undefined;
                const cellStyle: CSSProperties | undefined = slice ? { ...projectStyle, gridColumn: `calc(var(--flow-cell-column-start, 2) + ${slice.columnOffset}) / span ${slice.columnSpan}` } : projectStyle;
                const sliceData = slice ? { "data-flow-source-minute": slice.sourceMinute, "data-flow-slice-start": slice.startMinute, "data-flow-slice-duration": slice.endMinute - slice.startMinute } : {};
                const continuation = slice !== undefined && slice.startMinute !== slice.sourceMinute;
                const previewId = readOnlyPreview?.idsByCell.get(block.minuteOfDay);
                const isPreviewAnchor = !continuation && previewId !== undefined && firstPreviewMinuteById.get(previewId) === block.minuteOfDay;

                if (readOnlyPreview && previewId) {
                  return (
                    <span
                      className={`flow-cell ${colorClass}${unclassifiedClass}${remoteDeviceClass}${isCurrentHourCell ? " flow-cell--now-hour" : ""}`}
                      key={block.minuteOfDay}
                      role={isPreviewAnchor ? "img" : undefined}
                      tabIndex={isPreviewAnchor ? (!readOnlyPreview.tabStopId || readOnlyPreview.tabStopId === previewId ? 0 : -1) : undefined}
                      aria-label={isPreviewAnchor ? readOnlyPreview.ariaLabelsById.get(previewId) : undefined}
                      aria-hidden={isPreviewAnchor ? undefined : true}
                      data-flow-minute={block.minuteOfDay}
                      data-agent-hover-id={previewId}
                      style={cellStyle}
                      {...sliceData}
                    >
                      <span className="flow-cell__mark" aria-hidden="true" />
                    </span>
                  );
                }

                return (
                  <button
                    className={`flow-cell ${colorClass}${unclassifiedClass}${remoteDeviceClass}${isCurrentHourCell ? " flow-cell--now-hour" : ""}`}
                    key={block.minuteOfDay}
                    type="button"
                    aria-label={cellAriaLabelsByMinute.get(block.minuteOfDay)}
                    tabIndex={!continuation && block.minuteOfDay === tabStopMinute ? 0 : -1}
                    aria-describedby={!readOnlyPreview && !arrowKeysUsed && block.minuteOfDay === tabStopMinute ? keyboardHintId : undefined}
                    data-flow-minute={block.minuteOfDay}
                    data-flow-hour={slice?.rowIndex ?? hour}
                    data-flow-offset={slice ? slice.startMinute - slice.rowIndex * ROW_MINUTES : minuteOffset}
                    {...sliceData}
                    onFocus={() => setRovingMinute(block.minuteOfDay)}
                    data-funnel-classified-result={colorMode !== "project" && block.category !== "unknown" && block.sourceSegmentIds?.some((id) => classifiedResultIds?.has(id)) ? "true" : undefined}
                    data-activity-inspector-trigger="true"
                    aria-haspopup={onOpenActivity && inspection.presentation !== "panel" ? "dialog" : undefined}
                    aria-expanded={onOpenActivity ? inspectedGroup === hoverGroupsByCell.get(block.minuteOfDay) : undefined}
                    style={cellStyle}
                    onClick={(event) => {
                      const group = hoverGroupsByCell.get(block.minuteOfDay);
                      if (!group || !onOpenActivity) return;
                      onOpenActivity(group, event.currentTarget);
                    }}
                    onContextMenu={(event) => {
                      const group = hoverGroupsByCell.get(block.minuteOfDay);
                      if (!group || !onOpenActivity) return;
                      event.preventDefault();
                      onOpenActivity(group, event.currentTarget);
                    }}
                  >
                    <span className="flow-cell__mark" aria-hidden="true" />
                  </button>
                );
  }
});
