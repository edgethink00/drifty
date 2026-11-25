import type { ActivityCategory, FlowBlock } from "@drifty/domain";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { FlowChartLegend } from "./FlowChartLegend";
import type { FlowLegendHoverState } from "./FlowChartHoverCards";
import type { FlowColorMode } from "./FlowChartTypes";
import type { ProjectLegendEntry } from "./projectFlowView";
import { useLocalization } from "../localization/LocalizationContext";
import type { CategoryEditorTarget } from "../categories/categoryEditorModel";
import { ChartHeadControls } from "../dashboard/TimelineZoomControl";
import type { TimelineZoomState } from "../dashboard/timelineZoom";
import { FlowLegendLoading } from "../dashboard/DashboardLoadingParts";

type FlowChartHeaderProps = {
  readonly blocks: readonly FlowBlock[];
  readonly colorMode: FlowColorMode;
  readonly hoveredLegendCardRef: RefObject<HTMLDivElement | null>;
  readonly onColorModeChange: (mode: FlowColorMode) => void;
  readonly setHoveredLegend: Dispatch<SetStateAction<FlowLegendHoverState | null>>;
  readonly projectModeAvailable?: boolean;
  readonly projectLegend?: readonly ProjectLegendEntry[];
  /** Opens the category editor on the group the chart is colored by. */
  readonly onEditCategories?: (target: CategoryEditorTarget) => void;
  /** Whether the chart shows hatched iPhone time, which the legend then names. */
  readonly hasPhoneTime?: boolean;
  readonly timeZoom?: TimelineZoomState;
  /** The day is still loading: the switch and zoom stay live, the legend waits. */
  readonly loading?: boolean;
  /** The period's seconds per category, for the group chips' cards. */
  readonly categorySeconds?: Partial<Record<ActivityCategory, number>>;
};

/** The editor group a flow color mode shows. */
export function categoryEditorGroupFor(colorMode: FlowColorMode): CategoryEditorTarget {
  return { group: colorMode === "project" ? "project" : colorMode === "productivity" ? "productivity" : "category" };
}

export function FlowChartHeader({
  blocks,
  colorMode,
  hoveredLegendCardRef,
  onColorModeChange,
  setHoveredLegend,
  projectModeAvailable = false,
  projectLegend,
  onEditCategories,
  hasPhoneTime = false,
  timeZoom,
  loading = false,
  categorySeconds,
}: FlowChartHeaderProps) {
  const { t } = useLocalization();
  // Productivity, categories, projects: the category editor's tab order.
  const baseColorModeOptions = [
    { id: "productivity", label: t("dashboard.today.productivity") },
    { id: "category", label: t("dashboard.today.category") },
  ] as const satisfies readonly { readonly id: FlowColorMode; readonly label: string }[];
  const projectColorModeOption = { id: "project", label: t("dashboard.today.project") } as const satisfies { readonly id: FlowColorMode; readonly label: string };
  const colorModeOptions = projectModeAvailable
    ? [...baseColorModeOptions, projectColorModeOption]
    : baseColorModeOptions;
  return (
    <div className="flow-chart-head">
      <div className={`flow-chart-head__actions${timeZoom ? " flow-chart-head__actions--controls-first" : ""}`}>
        <ChartHeadControls timeZoom={timeZoom}>
          <div className="seg flow-color-mode-control" role="group" aria-label={t("dashboard.today.flowColorMode")}>
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
        </ChartHeadControls>
        {loading ? <FlowLegendLoading /> : (
          <FlowChartLegend
            blocks={blocks}
            colorMode={colorMode}
            hoveredLegendCardRef={hoveredLegendCardRef}
            setHoveredLegend={setHoveredLegend}
            projectLegend={projectLegend}
            onEdit={onEditCategories ? () => onEditCategories(categoryEditorGroupFor(colorMode)) : undefined}
            hasPhoneTime={hasPhoneTime}
            categorySeconds={categorySeconds}
          />
        )}
      </div>
    </div>
  );
}
