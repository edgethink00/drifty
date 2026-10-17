import { isAdditionalDisplayLanguage, supplementalText } from "../localization/supplementalCopy";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import type { FocusDriftPoint } from "./focusDriftChart";
import { categoryLabel, productivityLabel } from "../../lib/activityLabels";
import { formatLocalizedCompactDurationFromSeconds, formatQuarterHourLabel } from "../../lib/formatting";
import { useLocalization, type DisplayLanguage } from "../localization/LocalizationContext";
import { secondsToLabel } from "@drifty/domain";
import type { AppIconMap, DayRibbonSegment } from "@drifty/domain";
import { ClassificationSourceBadge } from "../classification/ClassificationSourceBadge";
import { getViewportSafeHoverPosition, type FixedHoverPosition } from "../../components/hoverCardPosition";
import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, useState } from "react";

export type TimelineHoverState = {
  segment: DayRibbonSegment;
  x: number;
  y: number;
};

export type FocusDriftHoverKind = "focus" | "drift";

export type FocusDriftHoverState = {
  point: FocusDriftPoint;
  kind: FocusDriftHoverKind;
  markerX: number;
  markerY: number;
  x: number;
  y: number;
};

export type CompactClassificationHoverState = {
  label: string;
  durationLabel: string;
  shareLabel: string;
  dotClassName: string;
  color: string;
  appBreakdown: CompactClassificationBreakdownRow[];
  x: number;
  y: number;
};

export type CompactClassificationHoverPayload = Omit<CompactClassificationHoverState, "x" | "y">;

export type CompactClassificationBreakdownRow = {
  appName: string;
  bundleId?: string | null;
  browserName?: string | null;
  siteDomain?: string | null;
  siteTitle?: string | null;
  totalSeconds: number;
};

export function CompactClassificationHoverCard({ hover, appIcons, language: languageOverride }: { hover: CompactClassificationHoverState; appIcons: AppIconMap; language?: DisplayLanguage }) {
  // Follows the display language unless a caller pins one. With an English
  // default, the Insights cards and the Your Week breakdown, which pass
  // nothing, showed "38% of tracked time" and "38m" in Korean.
  const { effectiveLanguage } = useLocalization();
  const language = languageOverride ?? effectiveLanguage;
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<FixedHoverPosition>(() => getViewportSafeHoverPosition(hover.x, hover.y, 0, 0));

  useLayoutEffect(() => {
    function updatePosition() {
      const bounds = cardRef.current?.getBoundingClientRect();
      const nextPosition = getViewportSafeHoverPosition(hover.x, hover.y, bounds?.width ?? 0, bounds?.height ?? 0);
      setPosition((currentPosition) => (
        currentPosition.left === nextPosition.left && currentPosition.top === nextPosition.top ? currentPosition : nextPosition
      ));
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [hover.appBreakdown, hover.durationLabel, hover.label, hover.shareLabel, hover.x, hover.y]);

  const card = (
    <div ref={cardRef} className="flow-hover-card category-hover-card compact-classification-hover-card" style={position}>
      <div className="category-hover-card__head">
        <span className={`category-dot ${hover.dotClassName}`} style={{ background: hover.color }} aria-hidden="true" />
        <strong>{hover.label}</strong>
      </div>
      <div className="category-treemap-hover-card__metric">
        <strong>{hover.durationLabel}</strong>
        <span>{(isAdditionalDisplayLanguage(language) ? supplementalText(language, "{{v0}} of tracked time", { v0: hover.shareLabel }) : language === "ko" ? `기록 시간의 ${hover.shareLabel}` : language === "es" ? `${hover.shareLabel} del tiempo registrado` : `${hover.shareLabel} of tracked time`)}</span>
      </div>
      <div className="category-treemap-hover-card__accent" aria-hidden="true">
        <span style={{ width: hover.shareLabel, background: hover.color }} />
      </div>
      <div className="category-hover-card__apps">
        {hover.appBreakdown.length > 0 ? hover.appBreakdown.map((item) => {
          const iconSrc = appIcons[item.bundleId ?? item.appName] ?? null;
          const label = item.siteDomain ?? item.siteTitle ?? item.appName;
          return (
            <div className="category-hover-card__app" key={`${item.siteDomain ?? item.siteTitle ?? item.bundleId ?? item.appName}`}>
              <span className="usage-identity-icon usage-identity-icon--sm">
                {item.siteDomain ? <SiteFavicon domain={item.siteDomain} size={20} fallbackIconSrc={iconSrc} /> : <AppGlyph appName={label} iconSrc={item.siteTitle ? null : iconSrc} size="sm" />}
              </span>
              <span>{label}</span>
              <strong>{formatLocalizedCompactDurationFromSeconds(item.totalSeconds, language)}</strong>
            </div>
          );
        }) : <span className="category-hover-card__empty">{(isAdditionalDisplayLanguage(language) ? supplementalText(language, "No app breakdown yet.") : language === "ko" ? "앱 분석이 아직 없습니다." : language === "es" ? "Aún no hay desglose por apps." : "No app breakdown yet.")}</span>}
      </div>
    </div>
  );

  return createPortal(card, document.body);
}

export function formatSharePercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function TimelineHoverCard({ hover }: { hover: TimelineHoverState }) {
  const lines = formatDayRibbonHoverTitle(hover.segment).split("\n");
  const [heading, duration, _activityLabel, ...activityLines] = lines;

  return (
    <div className="timeline-hover-card" style={{ left: hover.x + 16, top: hover.y + 16 }}>
      <div className="timeline-hover-card__head">
        <span className={`category-dot category-dot--${hover.segment.category}`} aria-hidden="true" />
        <strong>{heading}</strong>
      </div>
      <div className="timeline-hover-card__duration">{duration}</div>
      <ClassificationSourceBadge source={hover.segment.classificationSource} ai={hover.segment.aiClassification} aiCached={hover.segment.aiCachedClassification} />
      {activityLines.length > 0 ? (
        <div className="timeline-hover-card__activities">
          {activityLines.map((line) => <span key={line}>{line.replace(/^-\s*/, "")}</span>)}
        </div>
      ) : null}
    </div>
  );
}

export function formatDayRibbonHoverTitle(segment: DayRibbonSegment): string {
  const activityLines = segment.activities
    .slice()
    .sort((left, right) => right.durationSeconds - left.durationSeconds)
    .slice(0, 5)
    .map((activity) => `- ${formatActivityHoverLine(activity)}`);
  const remaining = segment.activities.length - activityLines.length;

  return [
    `${categoryLabel(segment.category)} · ${productivityLabel(segment.productivity)} · ${formatQuarterHourLabel(segment.startMinute)}–${formatQuarterHourLabel(segment.endMinute)}`,
    `Duration: ${secondsToLabel(segment.totalSeconds)}`,
    activityLines.length > 0 ? "Activities:" : "Activities: none captured",
    ...activityLines,
    remaining > 0 ? `- ${remaining} more ${remaining === 1 ? "activity" : "activities"}` : null,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function formatActivityHoverLine(activity: DayRibbonSegment["activities"][number]): string {
  const displayName = activity.siteDomain ?? activity.siteTitle ?? activity.appName;
  const detail = activity.windowTitle;
  return `${displayName}${detail && detail !== displayName ? ` · ${detail}` : ""} · ${secondsToLabel(activity.durationSeconds)}`;
}
