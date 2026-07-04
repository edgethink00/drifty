import { CATEGORY_COLORS, FLOW_BREAKDOWN_PRODUCTIVITY_ORDER, categoryLabel } from "../../lib/activityLabels";
import { CompactClassificationBar } from "./CompactClassificationBar";
import { CompactProductivityCircleChart } from "./CompactProductivityCircleChart";
import { buildCompactClassificationBreakdown } from "./compactChartBreakdown";
import type { AppIconMap, CategoryDuration, FlowBlock, ProductivityDuration } from "@drifty/domain";

type FlowCompactSplitChartProps = {
  readonly categoryEntries: CategoryDuration[];
  readonly productivityEntries: ProductivityDuration[];
  readonly totalSeconds: number;
  readonly flowBlocks: FlowBlock[];
  readonly appIcons: AppIconMap;
};

export function FlowCompactSplitChart({
  categoryEntries,
  productivityEntries,
  totalSeconds,
  flowBlocks,
  appIcons,
}: FlowCompactSplitChartProps) {
  const orderedProductivityEntries = FLOW_BREAKDOWN_PRODUCTIVITY_ORDER
    .map((productivity) => productivityEntries.find((entry) => entry.productivity === productivity))
    .filter((entry): entry is ProductivityDuration => Boolean(entry));
  const activeCategoryEntries = categoryEntries
    .filter((entry) => entry.totalSeconds > 0)
    .slice()
    .sort((left, right) => {
      // Unclassified is bookkeeping, not a real category: keep it last.
      if ((left.category === "unknown") !== (right.category === "unknown")) {
        return left.category === "unknown" ? 1 : -1;
      }
      return right.totalSeconds - left.totalSeconds;
    });

  return (
    <section className="flow-compact-split-chart" aria-label="Compact flow classification chart">
      <CompactProductivityCircleChart
        entries={orderedProductivityEntries}
        totalSeconds={totalSeconds}
        flowBlocks={flowBlocks}
        appIcons={appIcons}
      />
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
