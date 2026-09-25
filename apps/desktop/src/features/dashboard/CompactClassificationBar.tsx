import { useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import type { AppIconMap } from "@drifty/domain";
import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import { useLocalization, type DisplayLanguage } from "../localization/LocalizationContext";
import { CompactClassificationHoverCard } from "./HoverCards";
import type { CompactClassificationBreakdownRow, CompactClassificationHoverState } from "./HoverCards";
import { formatCompactBarLabel } from "./compactChartLabels";
import { tweenCompactBar } from "./compactChartTween";

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
  readonly language?: DisplayLanguage;
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
  language: languageOverride,
}: CompactClassificationBarProps<TEntry>) {
  const { effectiveLanguage } = useLocalization();
  const language = languageOverride ?? effectiveLanguage;
  const [hoveredSegment, setHoveredSegment] = useState<CompactClassificationHoverState | null>(null);
  const activeEntries = entries.filter((entry) => entry.totalSeconds > 0);
  const summaryEntries = activeEntries.length > 0 ? activeEntries : entries;
  const barLabel = formatCompactBarLabel(title, entries, getLabel, language);

  // Tween each segment's width from the previous period's share (see
  // compactChartTween). Keyed by title so the Day and Week category bars share
  // one memory and morph into each other across the remount on period switch.
  const segmentEls = useRef(new Map<string, HTMLSpanElement | null>());
  useLayoutEffect(() => {
    tweenCompactBar(
      `compact-bar:${title}`,
      entries.map((entry) => ({
        key: getKey(entry),
        el: segmentEls.current.get(getKey(entry)) ?? null,
        value: `${entry.ratio * 100}%`,
      })),
    );
  });

  function showSegmentHover(entry: TEntry, x: number, y: number) {
    setHoveredSegment({
      label: getLabel(entry),
      durationLabel: formatLocalizedCompactDurationFromSeconds(entry.totalSeconds, language),
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
        <strong>{formatLocalizedCompactDurationFromSeconds(totalSeconds, language)}</strong>
      </div>
      <div className="flow-compact-split-chart__bar" role="img" aria-label={barLabel}>
        {entries.map((entry) => (
          <span
            key={getKey(entry)}
            ref={(el) => { segmentEls.current.set(getKey(entry), el); }}
            className="flow-compact-split-chart__segment"
            style={{ width: `${entry.ratio * 100}%`, background: getColor(entry) }}
            title={`${getLabel(entry)} · ${formatLocalizedCompactDurationFromSeconds(entry.totalSeconds, language)} · ${Math.round(entry.ratio * 100)}%`}
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
            <span className="flow-compact-split-chart__legend-value">{formatLocalizedCompactDurationFromSeconds(entry.totalSeconds, language)}</span>
          </span>
        ))}
      </div>
      {hoveredSegment ? <CompactClassificationHoverCard hover={hoveredSegment} appIcons={appIcons} language={language} /> : null}
    </div>
  );
}
