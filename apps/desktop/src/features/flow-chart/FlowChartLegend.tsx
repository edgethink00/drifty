import { useLayoutEffect, useRef, useState, type CSSProperties, type Dispatch, type MouseEvent, type RefObject, type SetStateAction } from "react";
import { customCategoryIds, orderCategories, orderById, type ActivityCategory, type CustomProductivityLevel, type FlowBlock, type ProductivityLabel, type ProductivityLevel } from "@drifty/domain";
import { CATEGORY_COLORS, PRODUCTIVITY_COLORS } from "../../lib/activityLabels";
import { buildLegendActivityBreakdown, moveFlowHoverCardToPointer, type FlowLegendHoverState } from "./FlowChartHoverCards";
import type { FlowColorMode } from "./FlowChartTypes";
import type { ProjectLegendEntry } from "./projectFlowView";
import { useLocalization } from "../localization/LocalizationContext";
import { localizedCategoryLabel, localizedProductivityLabel } from "../localization/activityTranslations";
import { CategoryEditorPencil } from "../categories/CategoryEditorPencil";
import { useCategoryCustomizations, useCategoryOrder, useProductivityOrder, useProjectOrder, useProductivityLevels } from "../settings/categoryCustomizationStore";
import { productivityKeyFor } from "../productivity-levels/productivityLevelView";

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
  /** Names the hatched iPhone cells while the chart shows any. */
  readonly hasPhoneTime?: boolean;
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
  // A built-in productivity leaves out the time an added level shows.
  | { readonly kind: "productivity"; readonly productivity: ProductivityLabel }
  | { readonly kind: "level"; readonly level: CustomProductivityLevel };

type FlowLegendToneStyle = CSSProperties & Record<"--flow-legend-tone", string>;

const FLOW_CATEGORY_GROUPS = [
  { productivity: "focus", categories: ["workspace", "learning"] },
  { productivity: "neutral", categories: ["communication", "music", "utility"] },
  { productivity: "drift", categories: ["entertainment", "social_media", "shopping", "game"] },
] as const satisfies readonly FlowCategoryGroup[];

function blockMatchesCategories(categories: readonly ActivityCategory[]): (block: FlowBlock) => boolean {
  return (block) => categories.some((category) => category === block.category);
}

function blockMatchesRequest(request: FlowLegendBreakdownRequest, levels: readonly ProductivityLevel[]): (block: FlowBlock) => boolean {
  switch (request.kind) {
    case "category": return (block) => block.category === request.category;
    case "category-group": return blockMatchesCategories(request.categories);
    case "productivity": return (block) => productivityKeyFor(block.category, block.productivity, levels) === request.productivity;
    case "level": return (block) => productivityKeyFor(block.category, block.productivity, levels) === request.level;
  }
}

/* Category legend layout (2026-11-06). With room, the legend names every
   category the period used, in group order, with a thin rule between groups;
   the group a category belongs to shows in its hover card. Without room it
   folds to one entry per group: its colour dots, then the group name. */
const EXPANDED_ITEM_GAP = 10;
const EXPANDED_DOT = 8.74 + 5;
const EXPANDED_GROUP_RULE = 1 + EXPANDED_ITEM_GAP * 2;

function expandedLegendWidth(groups: readonly (readonly string[])[], font: string): number | null {
  const context = typeof document === "undefined" ? null : document.createElement("canvas").getContext?.("2d");
  if (!context) return null;
  context.font = font;
  let width = 0;
  groups.forEach((names, index) => {
    if (index > 0) width += EXPANDED_GROUP_RULE;
    names.forEach((name, itemIndex) => {
      if (itemIndex > 0) width += EXPANDED_ITEM_GAP;
      width += EXPANDED_DOT + context.measureText(name).width;
    });
  });
  return Math.ceil(width);
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
  hasPhoneTime = false,
}: FlowChartLegendProps) {
  const { t } = useLocalization();
  // Each category sits where it counts: the productivity or added level it
  // is fixed to, else where Drifty usually puts it. An added category Drifty
  // judges per activity gets its own named chip. Added levels follow neutral.
  const customizations = useCategoryCustomizations();
  const levels = useProductivityLevels();
  const productivityOrder = useProductivityOrder();
  const projectOrder = useProjectOrder();
  const addedCategories = customCategoryIds(customizations).filter((category) => !customizations[category]?.deletedAt);
  const levelOf = new Map(levels.flatMap((level) => level.categories.map((category) => [category, level.id] as const)));
  const usualLane = new Map<ActivityCategory, string>(FLOW_CATEGORY_GROUPS.flatMap((group) => group.categories.map((category) => [category, group.productivity] as const)));
  const laneOf = (category: ActivityCategory): string | null => levelOf.get(category) ?? customizations[category]?.productivity ?? usualLane.get(category) ?? null;
  // The dots in each group follow the user's category order.
  const categoryOrder = useCategoryOrder();
  const legendCategories = orderCategories([...FLOW_CATEGORY_GROUPS.flatMap((group) => group.categories), ...addedCategories], categoryOrder);
  const lanes: readonly { readonly key: string; readonly label: string; readonly color: string; readonly level: ProductivityLevel | null }[] = orderById(FLOW_CATEGORY_GROUPS.flatMap((group) => [
    { key: group.productivity, label: localizedProductivityLabel(group.productivity, t), color: PRODUCTIVITY_COLORS[group.productivity], level: null },
    ...(group.productivity === "neutral" ? levels.map((level) => ({ key: level.id, label: level.name, color: level.color, level })) : []),
  ]), productivityOrder, (lane) => lane.key);
  const categoryGroups = lanes
    .map((lane) => ({ ...lane, categories: legendCategories.filter((category) => laneOf(category) === lane.key) }))
    // A level shows on the category view only while a category is fixed to it.
    .filter((lane) => lane.level === null || lane.categories.length > 0);
  const unpinnedAddedCategories = addedCategories.filter((category) => laneOf(category) === null);
  const editPencil = onEdit ? <CategoryEditorPencil className="pencil-plate--sm flow-chart-legend__edit" label={t("categoryEditor.edit")} onClick={onEdit} /> : null;
  const categoryGroupLabel = (categories: readonly ActivityCategory[]) => categories.map((category) => localizedCategoryLabel(category, t)).join(", ");
  const categoryText = (category: ActivityCategory) => localizedCategoryLabel(category, t);
  const resolvedAriaLabel = ariaLabel ?? t("dashboard.today.flowLegend");
  const categoryHasTime = (category: ActivityCategory) => getAppBreakdown
    ? getAppBreakdown({ kind: "category", category }).length > 0
    : blocks.some((block) => block.category === category);
  const expandedGroups = categoryGroups
    .map((group) => ({ ...group, categories: group.categories.filter(categoryHasTime) }))
    .filter((group) => group.categories.length > 0);
  const expandedNames = expandedGroups.map((group) => group.categories.map(categoryText));
  const expandedKey = expandedNames.map((names) => names.join("|")).join("/");
  const legendRef = useRef<HTMLDivElement | null>(null);
  // "inline": names fit beside the head controls; "row": they take their own
  // line under them; "folded": not even a full line holds them.
  const [layout, setLayout] = useState<"inline" | "row" | "folded">("folded");
  const expanded = layout !== "folded";
  useLayoutEffect(() => {
    const legend = legendRef.current;
    if (colorMode !== "category" || !legend || expandedGroups.length === 0) { setLayout("folded"); return; }
    const fit = () => {
      const row = legend.parentElement;
      const full = row?.clientWidth ?? 0;
      // No layout (tests, hidden tabs): keep the folded groups.
      if (full <= 0 || !row) { setLayout("folded"); return; }
      const rowGap = parseFloat(getComputedStyle(row).columnGap) || 0;
      const besideLegend = Array.from(row.children)
        .filter((child) => child !== legend)
        .reduce((sum, child) => sum + (child as HTMLElement).getBoundingClientRect().width + rowGap, 0);
      const others = Array.from(legend.children)
        .filter((child) => !(child as HTMLElement).dataset.legendSet)
        .reduce((sum, child) => sum + (child as HTMLElement).getBoundingClientRect().width + EXPANDED_ITEM_GAP, 0);
      const needed = expandedLegendWidth(expandedNames, "500 12px " + getComputedStyle(legend).fontFamily);
      if (needed === null) { setLayout("folded"); return; }
      const width = needed + others;
      setLayout(width <= full - besideLegend ? "inline" : width <= full ? "row" : "folded");
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(legend.parentElement ?? legend);
    return () => observer.disconnect();
    // expandedKey stands in for the names the measurement depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMode, expandedKey]);
  const phoneLegend = hasPhoneTime ? (
    <span className="flow-chart-legend__group flow-chart-legend__group--phone">
      <span className="flow-chart-legend__parent flow-chart-legend__parent--tone" title={t("dashboard.today.phoneTimeLegendDetail")}>
        <span className="flow-chart-legend__phone-swatch" aria-hidden="true" />
        <span className="flow-chart-legend__label">{t("dashboard.today.phoneTime")}</span>
      </span>
    </span>
  ) : null;
  if (colorMode === "project") {
    return (
      <div className="flow-chart-legend flow-chart-legend--project" aria-label={t("dashboard.today.flowProjectLegend")}>
        {orderById(projectLegend ?? [], projectOrder, (entry) => entry.projectId ?? "").map((entry) => {
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
        {phoneLegend}
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
    appBreakdown: getAppBreakdown?.(request) ?? buildLegendActivityBreakdown(blocks, blockMatchesRequest(request, levels)),
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
    <div
      ref={legendRef}
      className={"flow-chart-legend" + (colorMode === "category" ? " flow-chart-legend--category" + (expanded ? " flow-chart-legend--expanded" : " flow-chart-legend--folded") + (layout === "row" ? " flow-chart-legend--own-row" : "") : "")}
      aria-label={resolvedAriaLabel}
    >
      {colorMode === "category" && expanded ? (
        expandedGroups.map((group) => (
          <span className="flow-chart-legend__group flow-chart-legend__group--named" data-legend-set="expanded" key={group.key} role="group" aria-label={group.label}>
            {group.categories.map((category) => {
              const toneStyle: FlowLegendToneStyle = { "--flow-legend-tone": CATEGORY_COLORS[category] };
              return (
                <span
                  className="flow-chart-legend__item"
                  key={category}
                  onMouseEnter={(event) => showLegendHover(event, categoryText(category), group.label, { kind: "category", category })}
                  onMouseMove={(event) => moveFlowHoverCardToPointer(hoveredLegendCardRef.current, event.clientX, event.clientY)}
                  onMouseLeave={() => setHoveredLegend(null)}
                >
                  <span className="flow-chart-legend__tone-dot" style={toneStyle} />
                  {categoryText(category)}
                </span>
              );
            })}
          </span>
        ))
      ) : colorMode === "category" ? (
        categoryGroups.map((group) => (
          <span className="flow-chart-legend__group" data-legend-set="folded" key={group.key}>
            <span
              className="flow-chart-legend__parent"
              onMouseEnter={(event) => showLegendHover(event, group.label, categoryGroupLabel(group.categories), { kind: "category-group", categories: group.categories })}
              onMouseMove={(event) => moveFlowHoverCardToPointer(hoveredLegendCardRef.current, event.clientX, event.clientY)}
              onMouseLeave={() => setHoveredLegend(null)}
              title={t("dashboard.today.flowCategoryGroup", { label: group.label })}
            >
              {group.label}
            </span>
            <span className="flow-chart-legend__categories" aria-label={t("dashboard.today.flowCategoryGroup", { label: group.label })}>
              {group.categories.map((category) => (
                <span
                  aria-label={categoryText(category)}
                  className={`flow-chart-legend__dot flow-chart-legend__dot--${category}`}
                  key={category}
                  onMouseEnter={(event) => showLegendHover(event, categoryText(category), group.label, { kind: "category", category })}
                  onMouseMove={(event) => moveFlowHoverCardToPointer(hoveredLegendCardRef.current, event.clientX, event.clientY)}
                  onMouseLeave={() => setHoveredLegend(null)}
                  title={categoryText(category)}
                />
              ))}
            </span>
          </span>
        ))
      ) : (
        lanes.map((lane) => {
          const toneStyle: FlowLegendToneStyle = { "--flow-legend-tone": lane.color };
          const request: FlowLegendBreakdownRequest = lane.level ? { kind: "level", level: lane.level.id } : { kind: "productivity", productivity: lane.key as ProductivityLabel };
          return (
            <span className="flow-chart-legend__group flow-chart-legend__group--productivity" key={lane.key}>
              <span
                className="flow-chart-legend__parent flow-chart-legend__parent--tone"
                onMouseEnter={(event) => showLegendHover(event, lane.label, t("dashboard.today.flowProductivityColor"), request)}
                onMouseMove={(event) => moveFlowHoverCardToPointer(hoveredLegendCardRef.current, event.clientX, event.clientY)}
                onMouseLeave={() => setHoveredLegend(null)}
                title={t("dashboard.today.flowBlocks", { label: lane.label })}
              >
                <span className="flow-chart-legend__tone-dot" style={toneStyle} />
                {lane.label}
              </span>
            </span>
          );
        })
      )}
      {colorMode === "category" ? unpinnedAddedCategories.map((category) => {
        const toneStyle: FlowLegendToneStyle = { "--flow-legend-tone": CATEGORY_COLORS[category] };
        return (
          <span className="flow-chart-legend__group flow-chart-legend__group--added" key={category}>
            <span
              className="flow-chart-legend__parent flow-chart-legend__parent--tone"
              onMouseEnter={(event) => showLegendHover(event, categoryText(category), t("dashboard.today.flowCategoryColor"), { kind: "category", category })}
              onMouseMove={(event) => moveFlowHoverCardToPointer(hoveredLegendCardRef.current, event.clientX, event.clientY)}
              onMouseLeave={() => setHoveredLegend(null)}
              title={categoryText(category)}
            >
              <span className="flow-chart-legend__tone-dot" style={toneStyle} />
              <span className="flow-chart-legend__label">{categoryText(category)}</span>
            </span>
          </span>
        );
      }) : null}
      {unclassifiedLegend}
      {phoneLegend}
      {editPencil}
    </div>
  );
}
