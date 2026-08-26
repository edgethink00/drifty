import { FLOW_INTERVAL_OPTIONS, type FlowBlock, type FlowIntervalMinutes } from "@drifty/domain";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { SettingsSelect } from "../settings/SettingsSelect";
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

const FLOW_DETAIL_COPY_BY_INTERVAL = {
  3: { value: "3", description: "More detail" },
  4: { value: "4", description: "Balanced" },
  5: { value: "5", description: "Less detail" },
  6: { value: "6", description: "Least detail" },
} as const satisfies Readonly<Record<FlowIntervalMinutes, { readonly value: string; readonly description: string }>>;

type FlowDetailValue = (typeof FLOW_DETAIL_COPY_BY_INTERVAL)[FlowIntervalMinutes]["value"];

const FLOW_DETAIL_OPTIONS = FLOW_INTERVAL_OPTIONS.map((intervalMinutes) => {
  const copy = FLOW_DETAIL_COPY_BY_INTERVAL[intervalMinutes];
  return {
    value: copy.value,
    label: `${intervalMinutes} min · ${copy.description}`,
  };
});

function flowIntervalFromDetailValue(value: FlowDetailValue): FlowIntervalMinutes {
  const intervalMinutes = FLOW_INTERVAL_OPTIONS.find(
    (option) => FLOW_DETAIL_COPY_BY_INTERVAL[option].value === value,
  );
  if (intervalMinutes === undefined) throw new Error(`Unsupported Flow detail value: ${value}`);
  return intervalMinutes;
}

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
        <div className="flow-chart-head__controls">
          {onIntervalChange ? (
            <SettingsSelect
              ariaLabel="Flow detail"
              className="flow-detail-select"
              value={FLOW_DETAIL_COPY_BY_INTERVAL[intervalMinutes].value}
              options={FLOW_DETAIL_OPTIONS}
              onChange={(value) => onIntervalChange(flowIntervalFromDetailValue(value))}
              triggerVisual={<FlowDetailIcon />}
            />
          ) : null}
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
        </div>
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

function FlowDetailIcon() {
  return (
    <svg className="flow-detail-select__icon" viewBox="0 0 18 6" fill="currentColor">
      <circle cx="3" cy="3" r="1.25" />
      <circle cx="9" cy="3" r="1.25" />
      <circle cx="15" cy="3" r="1.25" />
    </svg>
  );
}
