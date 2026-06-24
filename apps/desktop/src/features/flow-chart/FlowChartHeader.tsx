import { FLOW_INTERVAL_OPTIONS, type FlowBlock, type FlowIntervalMinutes } from "@drifty/domain";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { FlowChartLegend } from "./FlowChartLegend";
import type { FlowLegendHoverState } from "./FlowChartHoverCards";
import type { FlowColorMode } from "./FlowChartTypes";

type FlowChartHeaderProps = {
  readonly blocks: readonly FlowBlock[];
  readonly colorMode: FlowColorMode;
  readonly hoveredLegendCardRef: RefObject<HTMLDivElement | null>;
  readonly intervalMinutes: FlowIntervalMinutes;
  readonly onColorModeChange: Dispatch<SetStateAction<FlowColorMode>>;
  readonly onIntervalChange?: (intervalMinutes: FlowIntervalMinutes) => void;
  readonly setHoveredLegend: Dispatch<SetStateAction<FlowLegendHoverState | null>>;
};

const FLOW_COLOR_MODE_OPTIONS = [
  { id: "category", label: "Category" },
  { id: "productivity", label: "Productivity" },
] as const satisfies readonly { readonly id: FlowColorMode; readonly label: string }[];

export function FlowChartHeader({
  blocks,
  colorMode,
  hoveredLegendCardRef,
  intervalMinutes,
  onColorModeChange,
  onIntervalChange,
  setHoveredLegend,
}: FlowChartHeaderProps) {
  return (
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
              onClick={() => onColorModeChange(option.id)}
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
        <FlowChartLegend
          blocks={blocks}
          colorMode={colorMode}
          hoveredLegendCardRef={hoveredLegendCardRef}
          setHoveredLegend={setHoveredLegend}
        />
      </div>
    </div>
  );
}
