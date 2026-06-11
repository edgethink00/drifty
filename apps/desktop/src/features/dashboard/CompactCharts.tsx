import { DONUT_CIRCUMFERENCE } from "../insights/insightData";
import { CATEGORY_COLORS, FLOW_BREAKDOWN_PRODUCTIVITY_ORDER, PRODUCTIVITY_COLORS, categoryLabel, productivityLabel } from "../../lib/activityLabels";
import { formatCompactDurationFromSeconds } from "../../lib/formatting";
import { buildDonutArcSegments } from "../../lib/donutArcPath";
import { buildAppUsageSummaries } from "@drifty/domain";
import type { ActivitySegment, AppIconMap, CategoryDuration, FlowBlock, ProductivityDuration } from "@drifty/domain";
import { CompactClassificationHoverCard } from "./HoverCards";
import type { CompactClassificationBreakdownRow, CompactClassificationHoverState } from "./HoverCards";
import { useState } from "react";
import type { MouseEvent } from "react";

export function FlowCompactSplitChart({
  categoryEntries,
  productivityEntries,
  totalSeconds,
  flowBlocks,
  appIcons,
}: {
  categoryEntries: CategoryDuration[];
  productivityEntries: ProductivityDuration[];
  totalSeconds: number;
  flowBlocks: FlowBlock[];
  appIcons: AppIconMap;
}) {
  const orderedProductivityEntries = FLOW_BREAKDOWN_PRODUCTIVITY_ORDER
    .map((productivity) => productivityEntries.find((entry) => entry.productivity === productivity))
    .filter((entry): entry is ProductivityDuration => Boolean(entry));
  const activeCategoryEntries = categoryEntries
    .filter((entry) => entry.totalSeconds > 0)
    .slice()
    .sort((left, right) => right.totalSeconds - left.totalSeconds);

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

export function CompactProductivityCircleChart({
  entries,
  totalSeconds,
  flowBlocks,
  appIcons,
}: {
  entries: ProductivityDuration[];
  totalSeconds: number;
  flowBlocks: FlowBlock[];
  appIcons: AppIconMap;
}) {
  const [hoveredSegment, setHoveredSegment] = useState<CompactClassificationHoverState | null>(null);
  const activeEntries = entries.filter((entry) => entry.totalSeconds > 0 && entry.ratio > 0);
  const summaryEntries = activeEntries.length > 0 ? activeEntries : entries;
  const focusEntry = entries.find((entry) => entry.productivity === "focus");
  const focusSeconds = focusEntry?.totalSeconds ?? 0;
  const focusPercent = totalSeconds > 0 ? Math.round((focusSeconds / totalSeconds) * 100) : 0;
  const circleLabel = formatCompactBarLabel("Productivity", entries, (entry) => productivityLabel(entry.productivity));
  const gap = activeEntries.length > 1 ? 1.6 : 0;
  const circleSegments = buildDonutArcSegments(activeEntries, (entry) => entry.ratio, 50, 50, 40, gap / DONUT_CIRCUMFERENCE);

  function showSegmentHover(entry: ProductivityDuration, x: number, y: number) {
    setHoveredSegment({
      label: productivityLabel(entry.productivity),
      durationLabel: formatCompactDurationFromSeconds(entry.totalSeconds),
      shareLabel: `${Math.round(entry.ratio * 100)}%`,
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
          </div>
        </div>
        <div className="flow-compact-split-chart__legend" aria-hidden="true">
          {summaryEntries.map((entry) => (
            <span className="flow-compact-split-chart__legend-item" key={entry.productivity}>
              <span className="flow-compact-split-chart__swatch" style={{ background: PRODUCTIVITY_COLORS[entry.productivity] }} />
              <span className="flow-compact-split-chart__legend-label">{productivityLabel(entry.productivity)}</span>
              <span className="flow-compact-split-chart__legend-value">{formatCompactDurationFromSeconds(entry.totalSeconds)}</span>
            </span>
          ))}
        </div>
      </div>
      {hoveredSegment ? <CompactClassificationHoverCard hover={hoveredSegment} appIcons={appIcons} /> : null}
    </div>
  );
}

export function CompactClassificationBar<TEntry extends { totalSeconds: number; ratio: number }>({
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
}: {
  title: string;
  ariaLabel: string;
  entries: TEntry[];
  totalSeconds: number;
  getKey: (entry: TEntry) => string;
  getLabel: (entry: TEntry) => string;
  getColor: (entry: TEntry) => string;
  getDotClassName: (entry: TEntry) => string;
  getAppBreakdown: (entry: TEntry) => CompactClassificationBreakdownRow[];
  appIcons: AppIconMap;
  visibleLimit?: number;
}) {
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

export function buildCompactActivityBreakdown(segments: ActivitySegment[], divisor = 1): CompactClassificationBreakdownRow[] {
  const safeDivisor = Math.max(divisor, 1);
  return buildAppUsageSummaries(segments, { limit: 4 }).map((item) => ({
    appName: item.appName,
    bundleId: item.bundleId,
    browserName: item.browserName,
    siteDomain: item.siteDomain,
    siteTitle: item.siteTitle,
    totalSeconds: item.totalSeconds / safeDivisor,
  }));
}

export function buildCompactClassificationBreakdown(blocks: FlowBlock[], matchesSegment: (block: FlowBlock) => boolean): CompactClassificationBreakdownRow[] {
  const totals = new Map<string, CompactClassificationBreakdownRow>();

  for (const block of blocks) {
    if (!matchesSegment(block)) continue;
    const label = block.siteDomain ?? block.siteTitle ?? block.appName;
    const key = block.siteDomain ? `site:${block.siteDomain}` : block.siteTitle ? `title:${block.siteTitle}` : `app:${block.bundleId ?? block.appName}`;
    const existing = totals.get(key) ?? {
      appName: label,
      bundleId: block.siteDomain || block.siteTitle ? null : block.bundleId ?? null,
      browserName: block.browserName ?? null,
      siteDomain: block.siteDomain ?? null,
      siteTitle: block.siteTitle ?? null,
      totalSeconds: 0,
    };
    existing.totalSeconds += block.durationSeconds;
    totals.set(key, existing);
  }

  return Array.from(totals.values())
    .sort((left, right) => right.totalSeconds - left.totalSeconds || left.appName.localeCompare(right.appName))
    .slice(0, 4);
}

export function formatCompactBarLabel<TEntry extends { totalSeconds: number; ratio: number }>(
  title: string,
  entries: TEntry[],
  getLabel: (entry: TEntry) => string,
) {
  const parts = entries.map((entry) => `${getLabel(entry)} ${formatCompactDurationFromSeconds(entry.totalSeconds)} ${Math.round(entry.ratio * 100)}%`);
  return `${title} classification: ${parts.join(", ")}`;
}
