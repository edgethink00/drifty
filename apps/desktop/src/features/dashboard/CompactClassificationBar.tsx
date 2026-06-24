import { useState } from "react";
import type { MouseEvent } from "react";
import type { AppIconMap } from "@drifty/domain";
import { formatCompactDurationFromSeconds } from "../../lib/formatting";
import { CompactClassificationHoverCard } from "./HoverCards";
import type { CompactClassificationBreakdownRow, CompactClassificationHoverState } from "./HoverCards";
import { formatCompactBarLabel } from "./compactChartLabels";

type CompactClassificationEntry = {
  readonly totalSeconds: number;
  readonly ratio: number;
};

type CompactClassificationBarProps<TEntry extends CompactClassificationEntry> = {
  readonly title: string;
  readonly ariaLabel: string;
  readonly entries: TEntry[];
  readonly totalSeconds: number;
  readonly getKey: (entry: TEntry) => string;
  readonly getLabel: (entry: TEntry) => string;
  readonly getColor: (entry: TEntry) => string;
  readonly getDotClassName: (entry: TEntry) => string;
  readonly getAppBreakdown: (entry: TEntry) => CompactClassificationBreakdownRow[];
  readonly appIcons: AppIconMap;
  readonly visibleLimit?: number;
};

export function CompactClassificationBar<TEntry extends CompactClassificationEntry>({
  title,
  ariaLabel,
  entries,
  totalSeconds,
  getKey,
  getLabel,
  getColor,
  getDotClassName,
  getAppBreakdown,
  appIcons,
  visibleLimit = 3,
}: CompactClassificationBarProps<TEntry>) {
  const [hoveredSegment, setHoveredSegment] = useState<CompactClassificationHoverState | null>(null);
  const activeEntries = entries.filter((entry) => entry.totalSeconds > 0);
  const summaryEntries = activeEntries.length > 0 ? activeEntries : entries;
  const barLabel = formatCompactBarLabel(title, entries, getLabel);

  function showSegmentHover(entry: TEntry, x: number, y: number) {
    setHoveredSegment({
      label: getLabel(entry),
      durationLabel: formatCompactDurationFromSeconds(entry.totalSeconds),
      shareLabel: `${Math.round(entry.ratio * 100)}%`,
      dotClassName: getDotClassName(entry),
      color: getColor(entry),
      appBreakdown: getAppBreakdown(entry),
      x,
      y,
    });
  }

  return (
    <div className="flow-compact-split-chart__panel" aria-label={ariaLabel}>
      <div className="flow-compact-split-chart__head">
        <span className="label-mono">{title}</span>
        <strong>{formatCompactDurationFromSeconds(totalSeconds)}</strong>
      </div>
      <div className="flow-compact-split-chart__bar" role="img" aria-label={barLabel}>
        {entries.map((entry) => (
          <span
            key={getKey(entry)}
            className="flow-compact-split-chart__segment"
            style={{ width: `${entry.ratio * 100}%`, background: getColor(entry) }}
            title={`${getLabel(entry)} · ${formatCompactDurationFromSeconds(entry.totalSeconds)} · ${Math.round(entry.ratio * 100)}%`}
            onMouseEnter={(event: MouseEvent<HTMLSpanElement>) => showSegmentHover(entry, event.clientX, event.clientY)}
            onMouseMove={(event: MouseEvent<HTMLSpanElement>) => showSegmentHover(entry, event.clientX, event.clientY)}
            onMouseLeave={() => setHoveredSegment(null)}
          />
        ))}
      </div>
      <div className="flow-compact-split-chart__legend" aria-hidden="true">
        {summaryEntries.slice(0, visibleLimit).map((entry) => (
          <span className="flow-compact-split-chart__legend-item" key={getKey(entry)}>
            <span className="flow-compact-split-chart__swatch" style={{ background: getColor(entry) }} />
            <span className="flow-compact-split-chart__legend-label">{getLabel(entry)}</span>
            <span className="flow-compact-split-chart__legend-value">{formatCompactDurationFromSeconds(entry.totalSeconds)}</span>
          </span>
        ))}
      </div>
      {hoveredSegment ? <CompactClassificationHoverCard hover={hoveredSegment} appIcons={appIcons} /> : null}
    </div>
  );
}
