import type { CSSProperties, Dispatch, MouseEvent, RefObject, SetStateAction } from "react";
import type { ActivityCategory, FlowBlock, ProductivityLabel } from "@drifty/domain";
import { CATEGORY_COLORS, PRODUCTIVITY_COLORS, categoryLabel, productivityLabel } from "../../lib/activityLabels";
import { buildLegendActivityBreakdown, moveFlowHoverCardToPointer, type FlowLegendHoverState } from "./FlowChartHoverCards";
import type { FlowColorMode } from "./FlowChartTypes";
import type { ProjectLegendEntry } from "./projectFlowView";

type FlowCategoryGroup = {
  readonly productivity: ProductivityLabel;
  readonly categories: readonly ActivityCategory[];
};

type FlowChartLegendProps = {
  readonly blocks: readonly FlowBlock[];
  readonly colorMode: FlowColorMode;
  readonly hoveredLegendCardRef: RefObject<HTMLDivElement | null>;
  readonly setHoveredLegend: Dispatch<SetStateAction<FlowLegendHoverState | null>>;
  readonly projectLegend?: readonly ProjectLegendEntry[];
};

type FlowLegendToneStyle = CSSProperties & Record<"--flow-legend-tone", string>;

const FLOW_CATEGORY_GROUPS = [
  { productivity: "focus", categories: ["workspace", "learning"] },
  { productivity: "neutral", categories: ["communication", "music", "utility"] },
  { productivity: "drift", categories: ["entertainment", "social_media", "shopping", "game"] },
] as const satisfies readonly FlowCategoryGroup[];

function categoryGroupLabel(categories: readonly ActivityCategory[]): string {
  return categories.map(categoryLabel).join(", ");
}

function blockMatchesCategories(categories: readonly ActivityCategory[]): (block: FlowBlock) => boolean {
  return (block) => categories.some((category) => category === block.category);
}

export function FlowChartLegend({
  blocks,
  colorMode,
  hoveredLegendCardRef,
  setHoveredLegend,
  projectLegend,
}: FlowChartLegendProps) {
  if (colorMode === "project") {
    return (
      <div className="flow-chart-legend flow-chart-legend--project" aria-label="Flow chart projects">
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
      </div>
    );
  }
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
  const unclassifiedToneStyle: FlowLegendToneStyle = { "--flow-legend-tone": CATEGORY_COLORS.unknown };
  const unclassifiedLegend = (
    <span className="flow-chart-legend__group flow-chart-legend__group--unclassified">
      <span
        className="flow-chart-legend__parent flow-chart-legend__parent--tone"
        onMouseEnter={(event) => showLegendHover(event, categoryLabel("unknown"), "Not classified yet", (block) => block.category === "unknown")}
        onMouseMove={(event) => moveFlowHoverCardToPointer(hoveredLegendCardRef.current, event.clientX, event.clientY)}
        onMouseLeave={() => setHoveredLegend(null)}
        title="Unclassified blocks"
      >
        <span className="flow-chart-legend__tone-dot" style={unclassifiedToneStyle} />
        {categoryLabel("unknown")}
      </span>
    </span>
  );

  return (
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
        FLOW_CATEGORY_GROUPS.map((group) => {
          const toneStyle: FlowLegendToneStyle = { "--flow-legend-tone": PRODUCTIVITY_COLORS[group.productivity] };
          return (
            <span className="flow-chart-legend__group flow-chart-legend__group--productivity" key={group.productivity}>
              <span
                className="flow-chart-legend__parent flow-chart-legend__parent--tone"
                onMouseEnter={(event) => showLegendHover(event, productivityLabel(group.productivity), "Productivity color", (block) => block.productivity === group.productivity)}
                onMouseMove={(event) => moveFlowHoverCardToPointer(hoveredLegendCardRef.current, event.clientX, event.clientY)}
                onMouseLeave={() => setHoveredLegend(null)}
                title={`${productivityLabel(group.productivity)} blocks`}
              >
                <span className="flow-chart-legend__tone-dot" style={toneStyle} />
                {productivityLabel(group.productivity)}
              </span>
            </span>
          );
        })
      )}
      {unclassifiedLegend}
    </div>
  );
}
