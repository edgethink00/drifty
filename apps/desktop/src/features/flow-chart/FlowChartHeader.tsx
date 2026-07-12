import { FLOW_INTERVAL_OPTIONS, type FlowBlock, type FlowIntervalMinutes } from "@drifty/domain";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { FlowChartLegend } from "./FlowChartLegend";
import type { FlowLegendHoverState } from "./FlowChartHoverCards";
import type { FlowColorMode } from "./FlowChartTypes";
import type { ProjectLegendEntry } from "./projectFlowView";

type FlowChartHeaderProps = {
  readonly blocks: readonly FlowBlock[];
  readonly colorMode: FlowColorMode;
  readonly hoveredLegendCardRef: RefObject<HTMLDivElement | null>;
  readonly intervalMinutes: FlowIntervalMinutes;
  readonly onColorModeChange: (mode: FlowColorMode) => void;
  readonly onIntervalChange?: (intervalMinutes: FlowIntervalMinutes) => void;
  readonly setHoveredLegend: Dispatch<SetStateAction<FlowLegendHoverState | null>>;
  readonly projectModeAvailable?: boolean;
  readonly projectLegend?: readonly ProjectLegendEntry[];
};

const BASE_FLOW_COLOR_MODE_OPTIONS = [
  { id: "category", label: "Category" },
  { id: "productivity", label: "Productivity" },
] as const satisfies readonly { readonly id: FlowColorMode; readonly label: string }[];

const PROJECT_COLOR_MODE_OPTION = { id: "project", label: "Project" } as const satisfies { readonly id: FlowColorMode; readonly label: string };

export function FlowChartHeader({
  blocks,
  colorMode,
  hoveredLegendCardRef,
  intervalMinutes,
  onColorModeChange,
  onIntervalChange,
  setHoveredLegend,
  projectModeAvailable = false,
  projectLegend,
}: FlowChartHeaderProps) {
  const colorModeOptions = projectModeAvailable
    ? [...BASE_FLOW_COLOR_MODE_OPTIONS, PROJECT_COLOR_MODE_OPTION]
    : BASE_FLOW_COLOR_MODE_OPTIONS;
  return (
    <div className="flow-chart-head">
      <div className="flow-chart-head__actions">
        <div className="seg flow-color-mode-control" aria-label="Flow chart color mode">
          {colorModeOptions.map((option) => (
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
          projectLegend={projectLegend}
        />
      </div>
    </div>
  );
}
