import { useState } from "react";
import type { MouseEvent } from "react";
import type { AppIconMap, FlowBlock, ProductivityDuration } from "@drifty/domain";
import { DONUT_CIRCUMFERENCE } from "../insights/insightData";
import { PRODUCTIVITY_COLORS, productivityLabel } from "../../lib/activityLabels";
import { formatCompactDurationFromSeconds } from "../../lib/formatting";
import { buildDonutArcSegments } from "../../lib/donutArcPath";
import { CompactClassificationHoverCard } from "./HoverCards";
import type { CompactClassificationHoverState } from "./HoverCards";
import { buildCompactClassificationBreakdown } from "./compactChartBreakdown";
import { formatCompactBarLabel } from "./compactChartLabels";
import { useAnimatedDonutRatios } from "./compactChartTween";

type CompactProductivityCircleChartProps = {
  readonly entries: ProductivityDuration[];
  readonly totalSeconds: number;
  readonly flowBlocks: FlowBlock[];
  readonly appIcons: AppIconMap;
};

function formatProductivityLegendHours(totalSeconds: number): string {
  const hours = Math.max(0, Math.floor((totalSeconds / 3600) * 10) / 10);
  return `${hours.toFixed(1)}h`;
}

export function CompactProductivityCircleChart({
  entries,
  totalSeconds,
  flowBlocks,
  appIcons,
}: CompactProductivityCircleChartProps) {
  const [hoveredSegment, setHoveredSegment] = useState<CompactClassificationHoverState | null>(null);
  const activeEntries = entries.filter((entry) => entry.totalSeconds > 0 && entry.ratio > 0);
  const summaryEntries = activeEntries.length > 0 ? activeEntries : entries;
  const focusEntry = entries.find((entry) => entry.productivity === "focus");
  const focusSeconds = focusEntry?.totalSeconds ?? 0;
  // Entries carry classified time only; the percent is a share of that classified
  // total (the unclassified remainder up to totalSeconds is intentionally not shown).
  const classifiedSeconds = entries.reduce((sum, entry) => sum + entry.totalSeconds, 0);
  const unclassifiedSeconds = Math.max(0, totalSeconds - classifiedSeconds);
  const classificationCoveragePercent = totalSeconds > 0
    ? Math.round((classifiedSeconds / totalSeconds) * 100)
    : 0;
  const focusPercent = classifiedSeconds > 0 ? Math.round((focusSeconds / classifiedSeconds) * 100) : 0;
  const circleLabel = formatCompactBarLabel("Productivity", entries, (entry) => productivityLabel(entry.productivity));
  const gap = activeEntries.length > 1 ? 1.6 : 0;
  // Morph the arcs from the previous period's ratios across the Day↔Week remount
  // (shared cache key); arcs are built from the animating ratios so React paints
  // every frame. See compactChartTween.
  const animatedRatios = useAnimatedDonutRatios(
    "compact-donut:productivity",
    new Map(activeEntries.map((entry) => [entry.productivity, entry.ratio])),
  );
  const circleSegments = buildDonutArcSegments(
    activeEntries,
    (entry) => animatedRatios.get(entry.productivity) ?? entry.ratio,
    50,
    50,
    40,
    gap / DONUT_CIRCUMFERENCE,
  );

  function showSegmentHover(entry: ProductivityDuration, x: number, y: number) {
    setHoveredSegment({
      label: productivityLabel(entry.productivity),
      durationLabel: formatCompactDurationFromSeconds(entry.totalSeconds),
      shareLabel: `${classifiedSeconds > 0 ? Math.round((entry.totalSeconds / classifiedSeconds) * 100) : 0}%`,
      dotClassName: `productivity-dot--${entry.productivity}`,
      color: PRODUCTIVITY_COLORS[entry.productivity],
      appBreakdown: buildCompactClassificationBreakdown(flowBlocks, (block) => block.productivity === entry.productivity),
      x,
      y,
    });
  }

  return (
    <div className="flow-compact-split-chart__panel flow-compact-split-chart__panel--circle" aria-label="Productivity compact classification">
      <div className="flow-compact-split-chart__head">
        <span className="label-mono">Productivity</span>
        <strong>{formatCompactDurationFromSeconds(totalSeconds)}</strong>
      </div>
      <div className="flow-compact-productivity-circle">
        <div className="flow-compact-productivity-circle__dial-shell">
          <svg className="flow-compact-productivity-circle__dial" role="img" aria-label={circleLabel} viewBox="0 0 100 100">
            <circle className="flow-compact-productivity-circle__track" cx="50" cy="50" r="40" />
            {circleSegments.map(({ entry, pathData }) => (
              <path
                className="flow-compact-productivity-circle__segment"
                d={pathData}
                key={entry.productivity}
                stroke={PRODUCTIVITY_COLORS[entry.productivity]}
                onMouseEnter={(event: MouseEvent<SVGPathElement>) => showSegmentHover(entry, event.clientX, event.clientY)}
                onMouseMove={(event: MouseEvent<SVGPathElement>) => showSegmentHover(entry, event.clientX, event.clientY)}
                onMouseLeave={() => setHoveredSegment(null)}
              />
            ))}
          </svg>
          <div className="flow-compact-productivity-circle__center" aria-hidden="true">
            <strong>{focusPercent}%</strong>
            <span>focus</span>
          </div>
        </div>
        <div className="flow-compact-productivity-circle__details">
          <div className="flow-compact-split-chart__legend" aria-hidden="true">
            {summaryEntries.map((entry) => (
              <span className="flow-compact-split-chart__legend-item" key={entry.productivity}>
                <span className="flow-compact-split-chart__swatch" style={{ background: PRODUCTIVITY_COLORS[entry.productivity] }} />
                <span className="flow-compact-split-chart__legend-label">{productivityLabel(entry.productivity)}</span>
                <span className="flow-compact-split-chart__legend-value">{formatProductivityLegendHours(entry.totalSeconds)}</span>
              </span>
            ))}
          </div>
          <div className="flow-compact-productivity-circle__coverage">
            <span>Focus % uses classified time</span>
            {unclassifiedSeconds > 0 ? (
              <span>{classificationCoveragePercent}% classified · {formatCompactDurationFromSeconds(unclassifiedSeconds)} unclassified</span>
            ) : null}
          </div>
        </div>
      </div>
      {hoveredSegment ? <CompactClassificationHoverCard hover={hoveredSegment} appIcons={appIcons} /> : null}
    </div>
  );
}
