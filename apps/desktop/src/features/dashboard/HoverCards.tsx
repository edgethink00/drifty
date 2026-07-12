import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import type { FocusDriftPoint } from "./focusDriftChart";
import type { WeekCalendarEvent } from "./weekCalendar";
import { categoryLabel, productivityLabel } from "../../lib/activityLabels";
import { formatCompactDurationFromSeconds, formatQuarterHourLabel } from "../../lib/formatting";
import { secondsToLabel } from "@drifty/domain";
import type { AppIconMap, DayRibbonSegment } from "@drifty/domain";
import { ClassificationSourcePill } from "../classification/ClassificationBreakdownCards";
import { WeekCalendarIdentityIcon } from "./WeekDashboard";
import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export type TimelineHoverState = {
  segment: DayRibbonSegment;
  x: number;
  y: number;
};

export type FocusDriftHoverKind = "focus" | "drift";

export type FocusDriftHoverState = {
  point: FocusDriftPoint;
  kind: FocusDriftHoverKind;
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
  disableRemoteFavicons?: boolean;
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

export type WeekCalendarHoverState = {
  event: WeekCalendarEvent;
  x: number;
  y: number;
};

export type FixedHoverPosition = {
  left: number;
  top: number;
};

export const HOVER_CARD_OFFSET = 16;

export const HOVER_CARD_VIEWPORT_PADDING = 16;

export function CompactClassificationHoverCard({ hover, appIcons }: { hover: CompactClassificationHoverState; appIcons: AppIconMap }) {
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
        <span>{hover.shareLabel} of tracked time</span>
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
                {item.siteDomain && !hover.disableRemoteFavicons ? <SiteFavicon domain={item.siteDomain} size={20} fallbackIconSrc={iconSrc} /> : <AppGlyph appName={label} iconSrc={item.siteTitle ? null : iconSrc} size="sm" />}
              </span>
              <span>{label}</span>
              <strong>{secondsToLabel(item.totalSeconds)}</strong>
            </div>
          );
        }) : <span className="category-hover-card__empty">No app breakdown yet.</span>}
      </div>
    </div>
  );

  return createPortal(card, document.body);
}

export function WeekCalendarHoverCard({ hover, appIcons, cardRef: externalCardRef }: { hover: WeekCalendarHoverState; appIcons: AppIconMap; cardRef?: RefObject<HTMLDivElement> }) {
  const internalCardRef = useRef<HTMLDivElement>(null);
  const cardRef = externalCardRef ?? internalCardRef;
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
  }, [hover.event.id, hover.x, hover.y]);

  return (
    <div ref={cardRef} className="flow-hover-card week-calendar-hover-card" style={position}>
      <div className="category-hover-card__head">
        <span className={`category-dot category-dot--${hover.event.category}`} aria-hidden="true" />
        <strong>{categoryLabel(hover.event.category)}</strong>
      </div>
      <div className="timeline-hover-card__duration">{hover.event.startLabel}–{hover.event.endLabel}</div>
      <ClassificationSourcePill source={hover.event.classificationSource} ai={hover.event.aiClassification} />
      <div className="category-hover-card__apps">
        {hover.event.identities.map((identity) => (
          <div className="category-hover-card__app" key={identity.id}>
            <span className="usage-identity-icon usage-identity-icon--sm">
              <WeekCalendarIdentityIcon appIcons={appIcons} identity={identity} />
            </span>
            <span>{identity.label}</span>
            <strong>{formatCompactDurationFromSeconds(identity.seconds)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function clampHoverCoordinate(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function formatSharePercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function getViewportSafeHoverPosition(anchorX: number, anchorY: number, width: number, height: number): FixedHoverPosition {
  if (typeof window === "undefined") {
    return { left: anchorX + HOVER_CARD_OFFSET, top: anchorY + HOVER_CARD_OFFSET };
  }

  const { innerWidth, innerHeight } = window;
  const maxLeft = innerWidth - width - HOVER_CARD_VIEWPORT_PADDING;
  const maxTop = innerHeight - height - HOVER_CARD_VIEWPORT_PADDING;
  const preferredLeft = anchorX + HOVER_CARD_OFFSET;
  const preferredTop = anchorY + HOVER_CARD_OFFSET;
  const flippedLeft = anchorX - width - HOVER_CARD_OFFSET;
  const flippedTop = anchorY - height - HOVER_CARD_OFFSET;
  const left = preferredLeft > maxLeft && flippedLeft >= HOVER_CARD_VIEWPORT_PADDING ? flippedLeft : preferredLeft;
  const top = preferredTop > maxTop && flippedTop >= HOVER_CARD_VIEWPORT_PADDING ? flippedTop : preferredTop;

  return {
    left: clampHoverCoordinate(left, HOVER_CARD_VIEWPORT_PADDING, maxLeft),
    top: clampHoverCoordinate(top, HOVER_CARD_VIEWPORT_PADDING, maxTop),
  };
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
      <ClassificationSourcePill source={hover.segment.classificationSource} ai={hover.segment.aiClassification} aiCached={hover.segment.aiCachedClassification} />
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
