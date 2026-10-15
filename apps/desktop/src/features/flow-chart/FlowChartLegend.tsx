import type { CSSProperties, Dispatch, MouseEvent, RefObject, SetStateAction } from "react";
import type { ActivityCategory, FlowBlock, ProductivityLabel } from "@drifty/domain";
import { CATEGORY_COLORS, PRODUCTIVITY_COLORS } from "../../lib/activityLabels";
import { buildLegendActivityBreakdown, moveFlowHoverCardToPointer, type FlowLegendHoverState } from "./FlowChartHoverCards";
import type { FlowColorMode } from "./FlowChartTypes";
import type { ProjectLegendEntry } from "./projectFlowView";
import { useLocalization } from "../localization/LocalizationContext";
import { localizedCategoryLabel, localizedProductivityLabel } from "../localization/activityTranslations";
import { CategoryEditorPencil } from "../categories/CategoryEditorPencil";

type FlowCategoryGroup = {
  readonly productivity: ProductivityLabel;
  readonly categories: readonly ActivityCategory[];
};

type FlowChartLegendBaseProps = {
  readonly colorMode: FlowColorMode;
  readonly hoveredLegendCardRef: RefObject<HTMLDivElement | null>;
  readonly setHoveredLegend: Dispatch<SetStateAction<FlowLegendHoverState | null>>;
  readonly projectLegend?: readonly ProjectLegendEntry[];
  readonly ariaLabel?: string;
  /** Opens the category editor on whatever the legend is showing. */
  readonly onEdit?: () => void;
};

type FlowChartLegendProps = FlowChartLegendBaseProps & (
  | {
      readonly blocks: readonly FlowBlock[];
      readonly getAppBreakdown?: never;
      readonly hasUnclassified?: never;
    }
  | {
      readonly blocks?: never;
      readonly getAppBreakdown: (request: FlowLegendBreakdownRequest) => FlowLegendHoverState["appBreakdown"];
      readonly hasUnclassified: boolean;
    }
);

export type FlowLegendBreakdownRequest =
  | { readonly kind: "category"; readonly category: ActivityCategory }
  | { readonly kind: "category-group"; readonly categories: readonly ActivityCategory[] }
  | { readonly kind: "productivity"; readonly productivity: ProductivityLabel };

type FlowLegendToneStyle = CSSProperties & Record<"--flow-legend-tone", string>;

const FLOW_CATEGORY_GROUPS = [
  { productivity: "focus", categories: ["workspace", "learning"] },
  { productivity: "neutral", categories: ["communication", "music", "utility"] },
  { productivity: "drift", categories: ["entertainment", "social_media", "shopping", "game"] },
] as const satisfies readonly FlowCategoryGroup[];

function blockMatchesCategories(categories: readonly ActivityCategory[]): (block: FlowBlock) => boolean {
  return (block) => categories.some((category) => category === block.category);
}

function blockMatchesRequest(request: FlowLegendBreakdownRequest): (block: FlowBlock) => boolean {
  switch (request.kind) {
    case "category": return (block) => block.category === request.category;
    case "category-group": return blockMatchesCategories(request.categories);
    case "productivity": return (block) => block.productivity === request.productivity;
  }
}

export function FlowChartLegend({
  blocks = [],
  colorMode,
  hoveredLegendCardRef,
  setHoveredLegend,
  projectLegend,
  ariaLabel,
  getAppBreakdown,
  hasUnclassified,
  onEdit,
}: FlowChartLegendProps) {
  const { t } = useLocalization();
  const editPencil = onEdit ? <CategoryEditorPencil className="pencil-plate--sm flow-chart-legend__edit" label={t("categoryEditor.edit")} onClick={onEdit} /> : null;
  const categoryGroupLabel = (categories: readonly ActivityCategory[]) => categories.map((category) => localizedCategoryLabel(category, t)).join(", ");
  const categoryText = (category: ActivityCategory) => localizedCategoryLabel(category, t);
  const productivityText = (productivity: ProductivityLabel) => localizedProductivityLabel(productivity, t);
  const resolvedAriaLabel = ariaLabel ?? t("dashboard.today.flowLegend");
  if (colorMode === "project") {
    return (
      <div className="flow-chart-legend flow-chart-legend--project" aria-label={t("dashboard.today.flowProjectLegend")}>
        {(projectLegend ?? []).map((entry) => {
          const toneStyle: FlowLegendToneStyle = { "--flow-legend-tone": entry.color };
          return (
            <span className="flow-chart-legend__group flow-chart-legend__group--project" key={entry.projectId ?? "__none__"}>
              <span className="flow-chart-legend__parent flow-chart-legend__parent--tone" title={entry.name}>
                <span className="flow-chart-legend__tone-dot" style={toneStyle} />
                {entry.name}
              </span>
            </span>
          );
        })}
        {editPencil}
      </div>
    );
  }
  const showLegendHover = (
    event: MouseEvent<HTMLElement>,
    label: string,
    detailLabel: string,
    request: FlowLegendBreakdownRequest,
  ) => setHoveredLegend({
    label,
    detailLabel,
    appBreakdown: getAppBreakdown?.(request) ?? buildLegendActivityBreakdown(blocks, blockMatchesRequest(request)),
    x: event.clientX,
    y: event.clientY,
  });
  const unclassifiedToneStyle: FlowLegendToneStyle = { "--flow-legend-tone": CATEGORY_COLORS.unknown };
  /* The Unclassified chip is the widest entry in the row, so keeping it on for
     days that have no unclassified time pushed the head into a second line at
     normal window sizes (the head is only meant to stack under the narrow
     container breakpoint). It also only explains something the user can
     actually see, so it rides along with the gray cells it describes. */
  const hasUnclassifiedBlocks = hasUnclassified ?? blocks.some((block) => block.category === "unknown");
  const unclassifiedLegend = hasUnclassifiedBlocks ? (
    <span className="flow-chart-legend__group flow-chart-legend__group--unclassified">
      <span
        className="flow-chart-legend__parent flow-chart-legend__parent--tone"
        aria-label={categoryText("unknown")}
        onMouseEnter={(event) => showLegendHover(event, categoryText("unknown"), t("dashboard.today.flowUnclassifiedDetail"), { kind: "category", category: "unknown" })}
        onMouseMove={(event) => moveFlowHoverCardToPointer(hoveredLegendCardRef.current, event.clientX, event.clientY)}
        onMouseLeave={() => setHoveredLegend(null)}
        title={t("dashboard.today.flowUnclassifiedBlocks")}
      >
        <span className="flow-chart-legend__tone-dot" style={unclassifiedToneStyle} />
        <span className="flow-chart-legend__label">{categoryText("unknown")}</span>
      </span>
    </span>
  ) : null;

  return (
    <div className="flow-chart-legend" aria-label={resolvedAriaLabel}>
      {colorMode === "category" ? (
        FLOW_CATEGORY_GROUPS.map((group) => (
          <span className="flow-chart-legend__group" key={group.productivity}>
            <span
              className="flow-chart-legend__parent"
              onMouseEnter={(event) => showLegendHover(event, productivityText(group.productivity), categoryGroupLabel(group.categories), { kind: "category-group", categories: group.categories })}
              onMouseMove={(event) => moveFlowHoverCardToPointer(hoveredLegendCardRef.current, event.clientX, event.clientY)}
              onMouseLeave={() => setHoveredLegend(null)}
              title={t("dashboard.today.flowCategoryGroup", { label: productivityText(group.productivity) })}
            >
              {productivityText(group.productivity)}
            </span>
            <span className="flow-chart-legend__categories" aria-label={t("dashboard.today.flowCategoryGroup", { label: productivityText(group.productivity) })}>
              {group.categories.map((category) => (
                <span
                  aria-label={categoryText(category)}
                  className={`flow-chart-legend__dot flow-chart-legend__dot--${category}`}
                  key={category}
                  onMouseEnter={(event) => showLegendHover(event, categoryText(category), t("dashboard.today.flowCategoryColor"), { kind: "category", category })}
                  onMouseMove={(event) => moveFlowHoverCardToPointer(hoveredLegendCardRef.current, event.clientX, event.clientY)}
                  onMouseLeave={() => setHoveredLegend(null)}
                  title={categoryText(category)}
                />
              ))}
            </span>
          </span>
        ))
      ) : (
        FLOW_CATEGORY_GROUPS.map((group) => {
          const toneStyle: FlowLegendToneStyle = { "--flow-legend-tone": PRODUCTIVITY_COLORS[group.productivity] };
          return (
            <span className="flow-chart-legend__group flow-chart-legend__group--productivity" key={group.productivity}>
              <span
                className="flow-chart-legend__parent flow-chart-legend__parent--tone"
                onMouseEnter={(event) => showLegendHover(event, productivityText(group.productivity), t("dashboard.today.flowProductivityColor"), { kind: "productivity", productivity: group.productivity })}
                onMouseMove={(event) => moveFlowHoverCardToPointer(hoveredLegendCardRef.current, event.clientX, event.clientY)}
                onMouseLeave={() => setHoveredLegend(null)}
                title={t("dashboard.today.flowBlocks", { label: productivityText(group.productivity) })}
              >
                <span className="flow-chart-legend__tone-dot" style={toneStyle} />
                {productivityText(group.productivity)}
              </span>
            </span>
          );
        })
      )}
      {unclassifiedLegend}
      {editPencil}
    </div>
  );
}
