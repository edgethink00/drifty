import type { FlowBlock } from "@drifty/domain";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { FlowChartLegend } from "./FlowChartLegend";
import type { FlowLegendHoverState } from "./FlowChartHoverCards";
import type { FlowColorMode } from "./FlowChartTypes";
import type { ProjectLegendEntry } from "./projectFlowView";
import { useLocalization } from "../localization/LocalizationContext";

type FlowChartHeaderProps = {
  readonly blocks: readonly FlowBlock[];
  readonly colorMode: FlowColorMode;
  readonly hoveredLegendCardRef: RefObject<HTMLDivElement | null>;
  readonly onColorModeChange: (mode: FlowColorMode) => void;
  readonly setHoveredLegend: Dispatch<SetStateAction<FlowLegendHoverState | null>>;
  readonly projectModeAvailable?: boolean;
  readonly projectLegend?: readonly ProjectLegendEntry[];
};

export function FlowChartHeader({
  blocks,
  colorMode,
  hoveredLegendCardRef,
  onColorModeChange,
  setHoveredLegend,
  projectModeAvailable = false,
  projectLegend,
}: FlowChartHeaderProps) {
  const { t } = useLocalization();
  const baseColorModeOptions = [
    { id: "category", label: t("dashboard.today.category") },
    { id: "productivity", label: t("dashboard.today.productivity") },
  ] as const satisfies readonly { readonly id: FlowColorMode; readonly label: string }[];
  const projectColorModeOption = { id: "project", label: t("dashboard.today.project") } as const satisfies { readonly id: FlowColorMode; readonly label: string };
  const colorModeOptions = projectModeAvailable
    ? [...baseColorModeOptions, projectColorModeOption]
    : baseColorModeOptions;
  return (
    <div className="flow-chart-head">
      <div className="flow-chart-head__actions">
        <div className="flow-chart-head__controls">
          <div className="seg flow-color-mode-control" aria-label={t("dashboard.today.flowColorMode")}>
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
