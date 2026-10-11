import { memo, useId, useMemo, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { logicalMinuteOfDay, type FlowBlock, type FlowIntervalMinutes } from "@drifty/domain";
import type { FlowColorMode } from "./FlowChartTypes";
import { clockHourForLogicalHour, formatLocalizedCompactDurationFromSeconds, formatLocalizedCompactHourLabel } from "../../lib/formatting";
import { buildCellGroupAriaLabels, formatHourLabel, minuteOfDayForCell } from "./flowChartFormat";
import type { FlowBlockHoverGroup } from "./flowHoverGroups";
import { NO_PROJECT_COLOR } from "./projectFlowView";
import { useLocalization } from "../localization/LocalizationContext";
import { localizedCategoryLabel, localizedProductivityLabel } from "../localization/activityTranslations";

type FlowProjectCellStyle = CSSProperties & Record<"--flow-project-color", string>;

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
};

type FlowCurrentHourStyle = CSSProperties & Record<"--flow-current-hour", number>;

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

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
  hoverGroupsByCell,
  intervalMinutes,
  setFlowGridElement,
  onOpenActivity,
  inspectedGroup = null,
  readOnlyPreview,
}: FlowChartGridProps) {
  const { effectiveLanguage, t } = useLocalization();
  const rowMinuteOffsets = useMemo(
    () => Array.from({ length: 60 / intervalMinutes }, (_, index) => index * intervalMinutes),
    [intervalMinutes],
  );
  const cellAriaLabelsByMinute = useMemo(() => buildCellGroupAriaLabels(hoverGroupsByCell, {
    categoryLabel: ({ category }) => localizedCategoryLabel(category, t),
    productivityLabel: ({ productivity }) => localizedProductivityLabel(productivity, t),
    durationLabel: (seconds) => formatLocalizedCompactDurationFromSeconds(seconds, effectiveLanguage),
    timeBlockPrefix: effectiveLanguage === "ko" ? "시간대" : "Time block",
    durationPrefix: effectiveLanguage === "ko" ? "소요 시간" : "Duration",
  }), [effectiveLanguage, hoverGroupsByCell, t]);
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
    switch (event.key) {
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

  return (
    <>
      <div className="flow-chart-hours" aria-hidden="true">
        <span />
        {HOURS.map((hour) => {
          const clockHour = clockHourForLogicalHour(hour, boundaryMinutes);
          return (
            <span className={hour === currentHourIndex ? "flow-chart-hour--now" : undefined} key={hour}>
              {hour === currentHourIndex || hour % 3 === 0
                ? effectiveLanguage === "ko" ? formatLocalizedCompactHourLabel(clockHour, effectiveLanguage) : formatHourLabel(clockHour)
                : ""}
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
              {HOURS.map((hour) => {
                const minuteOfDay = minuteOfDayForCell(hour, minuteOffset, boundaryMinutes);
                const block = blockByCell.get(`${minuteOfDay}`);
                const isCurrentHourCell = hour === currentHourIndex && minuteOffset === currentMinuteOffset;
                if (!block) {
                  return (
                    <span
                      className={`flow-cell flow-cell--empty${isCurrentHourCell ? " flow-cell--now-hour" : ""}`}
                      key={minuteOfDay}
                      aria-hidden="true"
                    />
                  );
                }
                const isProjectMode = colorMode === "project";
                const unclassifiedClass = !isProjectMode && block.category === "unknown"
                  ? " flow-cell--unclassified"
                  : "";
                const colorClass = isProjectMode
                  ? "flow-cell--project"
                  : `flow-cell--${colorMode === "productivity" ? block.productivity : block.category}`;
                const remoteDeviceClass = block.deviceId ? " flow-cell--remote-device" : "";
                const cellStyle: FlowProjectCellStyle | undefined = isProjectMode
                  ? { "--flow-project-color": block.projectColor ?? NO_PROJECT_COLOR }
                  : undefined;
                const previewId = readOnlyPreview?.idsByCell.get(block.minuteOfDay);
                const isPreviewAnchor = previewId !== undefined && firstPreviewMinuteById.get(previewId) === block.minuteOfDay;

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
                    tabIndex={block.minuteOfDay === tabStopMinute ? 0 : -1}
                    aria-describedby={!readOnlyPreview && !arrowKeysUsed && block.minuteOfDay === tabStopMinute ? keyboardHintId : undefined}
                    data-flow-minute={block.minuteOfDay}
                    data-flow-hour={hour}
                    data-flow-offset={minuteOffset}
                    onFocus={() => setRovingMinute(block.minuteOfDay)}
                    data-funnel-classified-result={colorMode !== "project" && block.category !== "unknown" && block.sourceSegmentIds?.some((id) => classifiedResultIds?.has(id)) ? "true" : undefined}
                    data-activity-inspector-trigger="true"
                    aria-haspopup={onOpenActivity ? "dialog" : undefined}
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
              })}
            </div>
          );
        })}
      </div>
    </>
  );
});
