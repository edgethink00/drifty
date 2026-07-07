import { useState } from "react";
import type { MouseEvent } from "react";
import type { AppIconMap, FlowBlock } from "@drifty/domain";
import { DONUT_CIRCUMFERENCE } from "../insights/insightData";
import { formatCompactDurationFromSeconds } from "../../lib/formatting";
import { buildDonutArcSegments } from "../../lib/donutArcPath";
import { CompactClassificationHoverCard } from "./HoverCards";
import type { CompactClassificationHoverState } from "./HoverCards";
import { buildCompactClassificationBreakdown } from "./compactChartBreakdown";
import { formatCompactBarLabel } from "./compactChartLabels";

export interface CompactRingEntry {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly totalSeconds: number;
  readonly ratio: number;
  readonly matchesBlock: (block: FlowBlock) => boolean;
  // Optional decorative hover-dot class; the swatch/dot color always comes from `color`.
  readonly dotClassName?: string;
}

export interface CompactRingChartProps {
  readonly title: string;
  readonly entries: readonly CompactRingEntry[];
  readonly totalSeconds: number;
  readonly centerPercent: number;
  readonly flowBlocks: FlowBlock[];
  readonly appIcons: AppIconMap;
}

function formatCompactRingLegendHours(totalSeconds: number): string {
  const hours = Math.max(0, Math.floor((totalSeconds / 3600) * 10) / 10);
  return `${hours.toFixed(1)}h`;
}

export function CompactRingChart({
  title,
  entries,
  totalSeconds,
  centerPercent,
  flowBlocks,
  appIcons,
}: CompactRingChartProps) {
  const [hoveredSegment, setHoveredSegment] = useState<CompactClassificationHoverState | null>(null);
  const activeEntries = entries.filter((entry) => entry.totalSeconds > 0 && entry.ratio > 0);
  const summaryEntries = activeEntries.length > 0 ? activeEntries : entries;
  // Entries carry classified time only; the remainder up to totalSeconds is
  // unclassified (pending AI, blank screens) and stays out of the percent.
  const classifiedSeconds = entries.reduce((sum, entry) => sum + entry.totalSeconds, 0);
  const unclassifiedSeconds = Math.max(0, totalSeconds - classifiedSeconds);
  const hasPendingClassification = flowBlocks.some((block) => block.category === "unknown" && block.classificationSource === "unknown");
  const circleLabel = formatCompactBarLabel(title, entries, (entry) => entry.label);
  const gap = activeEntries.length > 1 ? 1.6 : 0;
  const circleSegments = buildDonutArcSegments(activeEntries, (entry) => entry.ratio, 50, 50, 40, gap / DONUT_CIRCUMFERENCE);

  function showSegmentHover(entry: CompactRingEntry, x: number, y: number) {
    setHoveredSegment({
      label: entry.label,
      durationLabel: formatCompactDurationFromSeconds(entry.totalSeconds),
      shareLabel: `${classifiedSeconds > 0 ? Math.round((entry.totalSeconds / classifiedSeconds) * 100) : 0}%`,
      dotClassName: entry.dotClassName ?? "",
      color: entry.color,
      appBreakdown: buildCompactClassificationBreakdown(flowBlocks, entry.matchesBlock),
      x,
      y,
    });
  }

  return (
    <div className="flow-compact-split-chart__panel flow-compact-split-chart__panel--circle" aria-label={`${title} compact classification`}>
      <div className="flow-compact-split-chart__head">
        <span className="label-mono">{title}</span>
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
                key={entry.key}
                stroke={entry.color}
                onMouseEnter={(event: MouseEvent<SVGPathElement>) => showSegmentHover(entry, event.clientX, event.clientY)}
                onMouseMove={(event: MouseEvent<SVGPathElement>) => showSegmentHover(entry, event.clientX, event.clientY)}
                onMouseLeave={() => setHoveredSegment(null)}
              />
            ))}
          </svg>
          <div className="flow-compact-productivity-circle__center" aria-hidden="true">
            <strong>{centerPercent}%</strong>
          </div>
        </div>
        <div className="flow-compact-split-chart__legend" aria-hidden="true">
          {summaryEntries.map((entry) => (
            <span className="flow-compact-split-chart__legend-item" key={entry.key}>
              <span className="flow-compact-split-chart__swatch" style={{ background: entry.color }} />
              <span className="flow-compact-split-chart__legend-label">{entry.label}</span>
              <span className="flow-compact-split-chart__legend-value">{formatCompactRingLegendHours(entry.totalSeconds)}</span>
            </span>
          ))}
        </div>
      </div>
      {unclassifiedSeconds >= 60 ? (
        <div className="flow-compact-productivity-circle__note">
          {formatCompactDurationFromSeconds(unclassifiedSeconds)} {hasPendingClassification ? "classifying…" : "unclassified"}
        </div>
      ) : null}
      {hoveredSegment ? <CompactClassificationHoverCard hover={hoveredSegment} appIcons={appIcons} /> : null}
    </div>
  );
}
