import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { FlowBlock, FlowIntervalMinutes } from "@drifty/domain";
import { FlowHoverGroupHighlights } from "./FlowHoverGroupHighlights";
import type { FlowHoverState } from "./FlowChartHoverCards";
import type { FlowColorMode } from "./FlowChartTypes";
import { clockHourForLogicalHour } from "../../lib/formatting";
import { buildCellGroupAriaLabels, formatHourLabel, minuteOfDayForCell } from "./flowChartFormat";
import { flowBlockHoverGroupPosition, type FlowBlockHoverGroup } from "./flowHoverGroups";
import { NO_PROJECT_COLOR } from "./projectFlowView";

type FlowProjectCellStyle = CSSProperties & Record<"--flow-project-color", string>;

type FlowChartGridProps = {
  readonly blockByCell: ReadonlyMap<string, FlowBlock>;
  readonly boundaryMinutes: number;
  readonly colorMode: FlowColorMode;
  readonly currentHourIndex: number | null;
  readonly currentMinuteOffset: number | null;
  readonly hoverGroupsByCell: ReadonlyMap<number, FlowBlockHoverGroup>;
  readonly hoveredBlock: FlowHoverState | null;
  readonly hoveredGroupMinutes: ReadonlySet<number> | null;
  readonly intervalMinutes: FlowIntervalMinutes;
  readonly setFlowGridElement: (element: HTMLDivElement | null) => void;
};

type FlowCurrentHourStyle = CSSProperties & Record<"--flow-current-hour", number>;

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export function FlowChartGrid({
  blockByCell,
  boundaryMinutes,
  colorMode,
  currentHourIndex,
  currentMinuteOffset,
  hoverGroupsByCell,
  hoveredBlock,
  hoveredGroupMinutes,
  intervalMinutes,
  setFlowGridElement,
}: FlowChartGridProps) {
  const rowMinuteOffsets = useMemo(
    () => Array.from({ length: 60 / intervalMinutes }, (_, index) => index * intervalMinutes),
    [intervalMinutes],
  );
  const cellAriaLabelsByMinute = useMemo(() => buildCellGroupAriaLabels(hoverGroupsByCell), [hoverGroupsByCell]);

  return (
    <>
      <div className="flow-chart-hours" aria-hidden="true">
        <span />
        {HOURS.map((hour) => {
          const clockHour = clockHourForLogicalHour(hour, boundaryMinutes);
          return (
            <span className={hour === currentHourIndex ? "flow-chart-hour--now" : undefined} key={hour}>
              {hour === currentHourIndex || hour % 3 === 0 ? formatHourLabel(clockHour) : ""}
            </span>
          );
        })}
      </div>
      <div className="flow-chart-grid" ref={setFlowGridElement}>
        {hoveredBlock ? <FlowHoverGroupHighlights group={hoveredBlock.group} intervalMinutes={intervalMinutes} boundaryMinutes={boundaryMinutes} /> : null}
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
                const hoverGroup = hoverGroupsByCell.get(block.minuteOfDay);
                if (!hoverGroup) return null;
                const hoverGroupPosition = hoveredGroupMinutes?.has(block.minuteOfDay) === true
                  ? flowBlockHoverGroupPosition(hoverGroup, block.minuteOfDay)
                  : null;
                const hoverGroupClass = hoverGroupPosition ? ` flow-cell--hover-group flow-cell--hover-group-${hoverGroupPosition}` : "";
                const isProjectMode = colorMode === "project";
                const unclassifiedClass = !isProjectMode && block.category === "unknown"
                  ? ` flow-cell--unclassified${block.classificationSource === "unknown" ? " flow-cell--unclassified-pending" : ""}`
                  : "";
                const colorClass = isProjectMode
                  ? "flow-cell--project"
                  : `flow-cell--${colorMode === "productivity" ? block.productivity : block.category}`;
                const remoteDeviceClass = block.deviceId ? " flow-cell--remote-device" : "";
                const cellStyle: FlowProjectCellStyle | undefined = isProjectMode
                  ? { "--flow-project-color": block.projectColor ?? NO_PROJECT_COLOR }
                  : undefined;

                return (
                  <button
                    className={`flow-cell ${colorClass}${unclassifiedClass}${remoteDeviceClass}${isCurrentHourCell ? " flow-cell--now-hour" : ""}${hoverGroupClass}`}
                    key={block.minuteOfDay}
                    type="button"
                    aria-label={cellAriaLabelsByMinute.get(block.minuteOfDay)}
                    data-flow-minute={block.minuteOfDay}
                    style={cellStyle}
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
}
