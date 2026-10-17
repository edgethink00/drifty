import { useState } from "react";
import type { MouseEvent } from "react";
import type { AppIconMap, FlowBlock } from "@drifty/domain";
import { DONUT_CIRCUMFERENCE } from "../insights/insightData";
import { formatLocalizedCompactDurationFromSeconds, localeForDisplayLanguage } from "../../lib/formatting";
import { useLocalization, type DisplayLanguage } from "../localization/LocalizationContext";
import { buildDonutArcSegments } from "../../lib/donutArcPath";
import { CompactClassificationHoverCard } from "./HoverCards";
import type { CompactClassificationBreakdownRow, CompactClassificationHoverState } from "./HoverCards";
import { buildCompactClassificationBreakdown } from "./compactChartBreakdown";
import { formatCompactBarLabel } from "./compactChartLabels";
import { useAnimatedDonutRatios } from "./compactChartTween";

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
  readonly ariaLabel?: string;
  readonly entries: readonly CompactRingEntry[];
  readonly totalSeconds: number;
  readonly centerPercent: number;
  readonly flowBlocks: FlowBlock[];
  readonly appIcons: AppIconMap;
  readonly getAppBreakdown?: (entry: CompactRingEntry) => CompactClassificationBreakdownRow[];
  readonly language?: DisplayLanguage;
}

function formatCompactRingLegendHours(totalSeconds: number, language: DisplayLanguage): string {
  if (language === "ko") return formatLocalizedCompactDurationFromSeconds(totalSeconds, language);
  const hours = Math.max(0, Math.floor((totalSeconds / 3600) * 10) / 10);
  if (language !== "en" && language !== "es") return new Intl.NumberFormat(localeForDisplayLanguage(language), { style: "unit", unit: "hour", unitDisplay: "short", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(hours);
  if (language === "es") return `${new Intl.NumberFormat(localeForDisplayLanguage(language), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(hours)} h`;
  return `${hours.toFixed(1)}h`;
}

export function CompactRingChart({
  title,
  ariaLabel,
  entries,
  totalSeconds,
  centerPercent,
  flowBlocks,
  appIcons,
  getAppBreakdown,
  language: languageOverride,
}: CompactRingChartProps) {
  const { effectiveLanguage } = useLocalization();
  const language = languageOverride ?? effectiveLanguage;
  const [hoveredSegment, setHoveredSegment] = useState<CompactClassificationHoverState | null>(null);
  const activeEntries = entries.filter((entry) => entry.totalSeconds > 0 && entry.ratio > 0);
  const summaryEntries = activeEntries.length > 0 ? activeEntries : entries;
  // Entries carry classified time only; hover shares are a percentage of that
  // classified total (the unclassified remainder is intentionally not shown).
  const classifiedSeconds = entries.reduce((sum, entry) => sum + entry.totalSeconds, 0);
  const circleLabel = formatCompactBarLabel(title, entries, (entry) => entry.label, language);
  const gap = activeEntries.length > 1 ? 1.6 : 0;
  // Morph the arcs from the previous render's ratios (keyed by title so the Day
  // and Week productivity donuts share one memory); arcs are built from the
  // animating ratios so React paints every frame. See compactChartTween.
  const animatedRatios = useAnimatedDonutRatios(
    `compact-donut:${title}`,
    new Map(activeEntries.map((entry) => [entry.key, entry.ratio])),
  );
  const circleSegments = buildDonutArcSegments(
    activeEntries,
    (entry) => animatedRatios.get(entry.key) ?? entry.ratio,
    50,
    50,
    40,
    gap / DONUT_CIRCUMFERENCE,
  );

  function showSegmentHover(entry: CompactRingEntry, x: number, y: number) {
    setHoveredSegment({
      label: entry.label,
      durationLabel: formatLocalizedCompactDurationFromSeconds(entry.totalSeconds, language),
      shareLabel: `${classifiedSeconds > 0 ? Math.round((entry.totalSeconds / classifiedSeconds) * 100) : 0}%`,
      dotClassName: entry.dotClassName ?? "",
      color: entry.color,
      appBreakdown: getAppBreakdown?.(entry) ?? buildCompactClassificationBreakdown(flowBlocks, entry.matchesBlock),
      x,
      y,
    });
  }

  return (
    <div className="flow-compact-split-chart__panel flow-compact-split-chart__panel--circle" aria-label={ariaLabel ?? `${title} compact classification`}>
      <div className="flow-compact-split-chart__head">
        <span className="label-mono">{title}</span>
        <strong>{formatLocalizedCompactDurationFromSeconds(totalSeconds, language)}</strong>
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
              <span className="flow-compact-split-chart__legend-value">{formatCompactRingLegendHours(entry.totalSeconds, language)}</span>
            </span>
          ))}
        </div>
      </div>
      {hoveredSegment ? <CompactClassificationHoverCard hover={hoveredSegment} appIcons={appIcons} language={language} /> : null}
    </div>
  );
}
