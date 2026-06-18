import { useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import { FLOW_INTERVAL_OPTIONS, logicalMinuteOfDay, type ActivityCategory, type FlowBlock, type FlowIntervalMinutes, type ProductivityLabel } from "@drifty/domain";
import { PRODUCTIVITY_COLORS, categoryLabel, productivityLabel } from "../../lib/activityLabels";
import { FlowHoverCard, FlowLegendHoverCard, buildLegendActivityBreakdown, moveFlowHoverCardToPointer, type FlowHoverState, type FlowLegendHoverState } from "./FlowChartHoverCards";
import { FlowHoverGroupHighlights } from "./FlowHoverGroupHighlights";
import { buildFlowBlockHoverGroups, flowBlockHoverGroupPosition } from "./flowHoverGroups";
import { buildCellGroupAriaLabels, clockHourForLogicalHour, formatHourLabel, minuteOfDayForCell, normalizeStartOfDayMinutes } from "./flowChartFormat";
import { useFlowChartHoverDelegation } from "./useFlowChartHoverDelegation";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const BASE_FLOW_CELL_INTERVAL_MINUTES = 3;
const FLOW_CELL_BASE_MIN_HEIGHT_REM = 0.5;
const FLOW_BREAKDOWN_CELL_BASE_MIN_HEIGHT_REM = 0.76;

type FlowColorMode = "category" | "productivity";

type FlowCategoryGroup = {
  readonly productivity: ProductivityLabel;
  readonly categories: readonly ActivityCategory[];
};

const FLOW_COLOR_MODE_OPTIONS = [
  { id: "category", label: "Category" },
  { id: "productivity", label: "Productivity" },
] as const satisfies readonly { readonly id: FlowColorMode; readonly label: string }[];

const FLOW_CATEGORY_GROUPS = [
  { productivity: "focus", categories: ["workspace", "learning"] },
  { productivity: "neutral", categories: ["communication", "music", "utility", "unknown"] },
  { productivity: "drift", categories: ["entertainment", "social_media", "shopping", "game"] },
] as const satisfies readonly FlowCategoryGroup[];

function categoryGroupLabel(categories: readonly ActivityCategory[]): string {
  return categories.map(categoryLabel).join(", ");
}

function blockMatchesCategories(categories: readonly ActivityCategory[]): (block: FlowBlock) => boolean {
  return (block) => categories.some((category) => category === block.category);
}

export function FlowChartView({
  blocks,
  appIcons,
  currentMinuteOfDay,
  intervalMinutes = 3,
  onIntervalChange,
  startOfDayMinutes = 0,
}: {
  blocks: FlowBlock[];
  appIcons: Record<string, string | null>;
  currentMinuteOfDay?: number | null;
  intervalMinutes?: FlowIntervalMinutes;
  onIntervalChange?: (intervalMinutes: FlowIntervalMinutes) => void;
  startOfDayMinutes?: number;
}) {
  const [hoveredBlock, setHoveredBlock] = useState<FlowHoverState | null>(null);
  const [hoveredLegend, setHoveredLegend] = useState<FlowLegendHoverState | null>(null);
  const [colorMode, setColorMode] = useState<FlowColorMode>("category");
  const [flowGridElement, setFlowGridElement] = useState<HTMLDivElement | null>(null);
  const hoveredBlockCardRef = useRef<HTMLDivElement>(null);
  const hoveredLegendCardRef = useRef<HTMLDivElement>(null);
  const hoveredGroupMinutes = useMemo(
    () => hoveredBlock ? new Set(hoveredBlock.group.blocks.map((block) => block.minuteOfDay)) : null,
    [hoveredBlock],
  );
  const rowMinuteOffsets = useMemo(
    () => Array.from({ length: 60 / intervalMinutes }, (_, index) => index * intervalMinutes),
    [intervalMinutes],
  );
  const boundaryMinutes = normalizeStartOfDayMinutes(startOfDayMinutes);
  const currentLogicalMinute = currentMinuteOfDay !== null && currentMinuteOfDay !== undefined ? logicalMinuteOfDay(currentMinuteOfDay, boundaryMinutes) : null;
  const currentHourIndex = currentLogicalMinute !== null ? Math.floor(currentLogicalMinute / 60) : null;
  const currentMinuteOffset = currentLogicalMinute !== null
    ? Math.floor((currentLogicalMinute % 60) / intervalMinutes) * intervalMinutes
    : null;
  const blockByCell = useMemo(() => {
    const next = new Map<string, FlowBlock>();
    for (const block of blocks) next.set(`${block.minuteOfDay}`, block);
    return next;
  }, [blocks]);
  const hoverGroupsByCell = useMemo(
    () => buildFlowBlockHoverGroups(blocks, intervalMinutes, boundaryMinutes),
    [blocks, boundaryMinutes, intervalMinutes],
  );
  const cellAriaLabelsByMinute = useMemo(() => buildCellGroupAriaLabels(hoverGroupsByCell), [hoverGroupsByCell]);
  useFlowChartHoverDelegation({ gridElement: flowGridElement, cardRef: hoveredBlockCardRef, hoverGroupsByCell, setHoveredBlock });
  const chartStyle: CSSProperties & Record<"--flow-cell-min-height" | "--flow-breakdown-cell-min-height" | "--flow-row-count", string> = {
    "--flow-cell-min-height": `${(FLOW_CELL_BASE_MIN_HEIGHT_REM * intervalMinutes) / BASE_FLOW_CELL_INTERVAL_MINUTES}rem`,
    "--flow-breakdown-cell-min-height": `${(FLOW_BREAKDOWN_CELL_BASE_MIN_HEIGHT_REM * intervalMinutes) / BASE_FLOW_CELL_INTERVAL_MINUTES}rem`,
    "--flow-row-count": `${60 / intervalMinutes}`,
  };
  const showLegendHover = (
    event: MouseEvent<HTMLElement>,
    label: string,
    detailLabel: string,
    matchesBlock: (block: FlowBlock) => boolean,
  ) => setHoveredLegend({
    label,
    detailLabel,
    appBreakdown: buildLegendActivityBreakdown(blocks, matchesBlock),
    x: event.clientX,
    y: event.clientY,
  });
  if (blocks.length === 0) return null;

  return (
    <section className="flow-chart-card" aria-label={`${intervalMinutes}-minute flow chart`} data-flow-interval={intervalMinutes} data-flow-color-mode={colorMode} style={chartStyle}>
      <div className="flow-chart-head">
        <div>
          <span className="label-mono">flow chart</span>
          <p className="flow-chart-copy">{intervalMinutes}-minute cells show the dominant app or site in each block.</p>
        </div>
        <div className="flow-chart-head__actions">
          <div className="seg flow-color-mode-control" aria-label="Flow chart color mode">
            {FLOW_COLOR_MODE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={option.id === colorMode ? "on" : undefined}
                aria-pressed={option.id === colorMode}
                onClick={() => setColorMode(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {onIntervalChange ? (
            <div className="seg flow-interval-control" aria-label="Flow chart interval">
              {FLOW_INTERVAL_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={option === intervalMinutes ? "on" : undefined}
                  aria-pressed={option === intervalMinutes}
                  onClick={() => onIntervalChange(option)}
                >
                  {option}m
                </button>
              ))}
            </div>
          ) : null}
          <div className="flow-chart-legend" aria-label="Flow chart tones">
            {colorMode === "category" ? (
              FLOW_CATEGORY_GROUPS.map((group) => (
                <span className="flow-chart-legend__group" key={group.productivity}>
                  <span
                    className="flow-chart-legend__parent"
                    onMouseEnter={(event) => showLegendHover(event, productivityLabel(group.productivity), categoryGroupLabel(group.categories), blockMatchesCategories(group.categories))}
                    onMouseMove={(event) => moveFlowHoverCardToPointer(hoveredLegendCardRef.current, event.clientX, event.clientY)}
                    onMouseLeave={() => setHoveredLegend(null)}
                    title={`${productivityLabel(group.productivity)} categories`}
                  >
                    {productivityLabel(group.productivity)}
                  </span>
                  <span className="flow-chart-legend__categories" aria-label={`${productivityLabel(group.productivity)} categories`}>
                    {group.categories.map((category) => (
                      <span
                        aria-label={categoryLabel(category)}
                        className={`flow-chart-legend__dot flow-chart-legend__dot--${category}`}
                        key={category}
                        onMouseEnter={(event) => showLegendHover(event, categoryLabel(category), "Category color", (block) => block.category === category)}
                        onMouseMove={(event) => moveFlowHoverCardToPointer(hoveredLegendCardRef.current, event.clientX, event.clientY)}
                        onMouseLeave={() => setHoveredLegend(null)}
                        title={categoryLabel(category)}
                      />
                    ))}
                  </span>
                </span>
              ))
            ) : (
              FLOW_CATEGORY_GROUPS.map((group) => (
                <span className="flow-chart-legend__group flow-chart-legend__group--productivity" key={group.productivity}>
                  <span
                    className="flow-chart-legend__parent flow-chart-legend__parent--tone"
                    onMouseEnter={(event) => showLegendHover(event, productivityLabel(group.productivity), "Productivity color", (block) => block.productivity === group.productivity)}
                    onMouseMove={(event) => moveFlowHoverCardToPointer(hoveredLegendCardRef.current, event.clientX, event.clientY)}
                    onMouseLeave={() => setHoveredLegend(null)}
                    title={`${productivityLabel(group.productivity)} blocks`}
                  >
                    <span className="flow-chart-legend__tone-dot" style={{ "--flow-legend-tone": PRODUCTIVITY_COLORS[group.productivity] } as CSSProperties & Record<"--flow-legend-tone", string>} />
                    {productivityLabel(group.productivity)}
                  </span>
                </span>
              ))
            )}
          </div>
        </div>
      </div>

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

          return (
            <div
              className={`flow-chart-row${isCurrentMinuteRow ? " flow-chart-row--now" : ""}${isTerminalCurrentMinuteRow ? " flow-chart-row--now-terminal" : ""}${isCurrentTimeLabelRow ? " flow-chart-row--time-label" : ""}`}
              key={minuteOffset}
              style={isCurrentMinuteRow && currentHourIndex !== null ? { "--flow-current-hour": currentHourIndex } as CSSProperties & Record<"--flow-current-hour", number> : undefined}
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

                return (
                  <button
                    className={`flow-cell flow-cell--${colorMode === "productivity" ? block.productivity : block.category}${isCurrentHourCell ? " flow-cell--now-hour" : ""}${hoverGroupClass}`}
                    key={block.minuteOfDay}
                    type="button"
                    aria-label={cellAriaLabelsByMinute.get(block.minuteOfDay)}
                    data-flow-minute={block.minuteOfDay}
                  >
                    <span className="flow-cell__mark" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {hoveredBlock ? <FlowHoverCard hover={hoveredBlock} appIcons={appIcons} cardRef={hoveredBlockCardRef} /> : null}
      {hoveredLegend ? <FlowLegendHoverCard hover={hoveredLegend} appIcons={appIcons} cardRef={hoveredLegendCardRef} /> : null}
    </section>
  );
}
