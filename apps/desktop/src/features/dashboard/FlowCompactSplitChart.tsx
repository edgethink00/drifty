import {
  CATEGORY_COLORS,
  FLOW_BREAKDOWN_PRODUCTIVITY_ORDER,
  PRODUCTIVITY_COLORS,
  categoryLabel,
  productivityLabel,
} from "../../lib/activityLabels";
import { CompactClassificationBar } from "./CompactClassificationBar";
import { CompactRingChart } from "./CompactRingChart";
import type { CompactRingEntry } from "./CompactRingChart";
import { buildCompactClassificationBreakdown } from "./compactChartBreakdown";
import type { AppIconMap, CategoryDuration, FlowBlock, ProductivityDuration } from "@drifty/domain";

/** The donut shows Productivity by default and swaps to the project split when
 *  the flow chart's Project toggle is active. The category bar never changes. */
export type FlowCompactDonutMode = "productivity" | "project";

type FlowCompactSplitChartProps = {
  readonly categoryEntries: CategoryDuration[];
  readonly productivityEntries: ProductivityDuration[];
  readonly totalSeconds: number;
  readonly flowBlocks: FlowBlock[];
  readonly appIcons: AppIconMap;
  readonly donutMode?: FlowCompactDonutMode;
  readonly projectRingEntries?: readonly CompactRingEntry[];
  readonly projectCenterPercent?: number;
};

/** Productivity donut entries in the fixed focus/neutral/drift order. */
export function buildProductivityRingEntries(productivityEntries: ProductivityDuration[]): CompactRingEntry[] {
  return FLOW_BREAKDOWN_PRODUCTIVITY_ORDER
    .map((productivity) => productivityEntries.find((entry) => entry.productivity === productivity))
    .filter((entry): entry is ProductivityDuration => Boolean(entry))
    .map((entry) => ({
      key: entry.productivity,
      label: productivityLabel(entry.productivity),
      color: PRODUCTIVITY_COLORS[entry.productivity],
      totalSeconds: entry.totalSeconds,
      ratio: entry.ratio,
      matchesBlock: (block) => block.productivity === entry.productivity,
      dotClassName: `productivity-dot--${entry.productivity}`,
    }));
}

/** Focus share of classified time (the productivity ring excludes unclassified). */
export function buildProductivityCenterPercent(productivityEntries: ProductivityDuration[]): number {
  const classifiedSeconds = productivityEntries.reduce((sum, entry) => sum + entry.totalSeconds, 0);
  const focusSeconds = productivityEntries.find((entry) => entry.productivity === "focus")?.totalSeconds ?? 0;
  return classifiedSeconds > 0 ? Math.round((focusSeconds / classifiedSeconds) * 100) : 0;
}

/** Category bar entries with the unclassified bookkeeping bucket kept last. */
export function buildActiveCategoryEntries(categoryEntries: CategoryDuration[]): CategoryDuration[] {
  return categoryEntries
    .filter((entry) => entry.totalSeconds > 0)
    .slice()
    .sort((left, right) => {
      // Unclassified is bookkeeping, not a real category: keep it last.
      if ((left.category === "unknown") !== (right.category === "unknown")) {
        return left.category === "unknown" ? 1 : -1;
      }
      return right.totalSeconds - left.totalSeconds;
    });
}

export function FlowCompactSplitChart({
  categoryEntries,
  productivityEntries,
  totalSeconds,
  flowBlocks,
  appIcons,
  donutMode = "productivity",
  projectRingEntries = [],
  projectCenterPercent = 0,
}: FlowCompactSplitChartProps) {
  const activeCategoryEntries = buildActiveCategoryEntries(categoryEntries);
  const productivityRingEntries = buildProductivityRingEntries(productivityEntries);
  const productivityCenterPercent = buildProductivityCenterPercent(productivityEntries);

  // Only swap to the project donut when the toggle asks for it and there is data;
  // otherwise the productivity donut stays (e.g. a day with no assignments yet).
  const showProject = donutMode === "project" && projectRingEntries.length > 0;

  return (
    <section className="flow-compact-split-chart" aria-label="Compact flow classification chart">
      <div className="flow-compact-split-chart__donut" key={showProject ? "project" : "productivity"}>
        {showProject ? (
          <CompactRingChart
            title="Projects"
            entries={projectRingEntries}
            totalSeconds={totalSeconds}
            centerPercent={projectCenterPercent}
            flowBlocks={flowBlocks}
            appIcons={appIcons}
          />
        ) : (
          <CompactRingChart
            title="Productivity"
            entries={productivityRingEntries}
            totalSeconds={totalSeconds}
            centerPercent={productivityCenterPercent}
            flowBlocks={flowBlocks}
            appIcons={appIcons}
          />
        )}
      </div>
      <CompactClassificationBar<CategoryDuration>
        title="Categories"
        ariaLabel="Category compact classification"
        entries={activeCategoryEntries}
        totalSeconds={totalSeconds}
        getKey={(entry) => entry.category}
        getLabel={(entry) => categoryLabel(entry.category)}
        getColor={(entry) => CATEGORY_COLORS[entry.category]}
        getDotClassName={(entry) => `category-dot--${entry.category}`}
        getAppBreakdown={(entry) => buildCompactClassificationBreakdown(flowBlocks, (block) => block.category === entry.category)}
        appIcons={appIcons}
        visibleLimit={5}
      />
    </section>
  );
}
