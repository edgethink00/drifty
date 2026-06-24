import type { CSSProperties, Dispatch, MouseEvent, RefObject, SetStateAction } from "react";
import type { ActivityCategory, FlowBlock, ProductivityLabel } from "@drifty/domain";
import { PRODUCTIVITY_COLORS, categoryLabel, productivityLabel } from "../../lib/activityLabels";
import { buildLegendActivityBreakdown, moveFlowHoverCardToPointer, type FlowLegendHoverState } from "./FlowChartHoverCards";
import type { FlowColorMode } from "./FlowChartTypes";

type FlowCategoryGroup = {
  readonly productivity: ProductivityLabel;
  readonly categories: readonly ActivityCategory[];
};

type FlowChartLegendProps = {
  readonly blocks: readonly FlowBlock[];
  readonly colorMode: FlowColorMode;
  readonly hoveredLegendCardRef: RefObject<HTMLDivElement | null>;
  readonly setHoveredLegend: Dispatch<SetStateAction<FlowLegendHoverState | null>>;
};

type FlowLegendToneStyle = CSSProperties & Record<"--flow-legend-tone", string>;

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

export function FlowChartLegend({
  blocks,
  colorMode,
  hoveredLegendCardRef,
  setHoveredLegend,
}: FlowChartLegendProps) {
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
    </div>
  );
}
