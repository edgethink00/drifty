import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { formatCompactDurationFromSeconds, formatDuration } from "../../lib/formatting";
import type { AppIconMap } from "@drifty/domain";
import type { FocusDriftPoint, FocusDriftSourceSummary } from "./focusDriftChart";
import { formatSharePercent, getViewportSafeHoverPosition } from "./HoverCards";
import type { FixedHoverPosition, FocusDriftHoverKind, FocusDriftHoverState } from "./HoverCards";
import { useLayoutEffect, useRef, useState } from "react";

type FocusDriftHoverCardProps = {
  readonly hover: FocusDriftHoverState;
  readonly appIcons: AppIconMap;
};

type FocusDriftMetric = {
  readonly kind: FocusDriftHoverKind;
  readonly value: string;
  readonly share: string;
};

const HOVER_KIND_LABELS: Record<FocusDriftHoverKind, string> = {
  focus: "Focus",
  drift: "Drift",
};

const SOURCE_KIND_LABELS: Record<FocusDriftHoverKind, string> = {
  focus: "Top focus source",
  drift: "Top drift source",
};

export function FocusDriftHoverCard({ hover, appIcons }: FocusDriftHoverCardProps) {
  const { point } = hover;
  const cardRef = useRef<HTMLDivElement>(null);
  const focusPercent = formatSharePercent(point.focusScore);
  const driftPercent = formatSharePercent(point.driftScore);
  const focusDuration = formatDuration(point.focusSeconds);
  const driftDuration = formatDuration(point.driftSeconds);
  const isFocusHeavy = point.focusScore >= point.driftScore;
  const verdict = isFocusHeavy ? "Focus-heavy" : "Drift-heavy";
  const metrics = buildFocusDriftMetrics(focusDuration, driftDuration, focusPercent, driftPercent);
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
  }, [
    driftDuration,
    driftPercent,
    focusDuration,
    focusPercent,
    hover.x,
    hover.y,
    point.id,
    point.label,
    point.topDriftSource?.captures,
    point.topDriftSource?.id,
    point.topDriftSource?.seconds,
    point.topFocusSource?.captures,
    point.topFocusSource?.id,
    point.topFocusSource?.seconds,
  ]);

  return (
    <div ref={cardRef} className={`focus-drift-hover-card focus-drift-hover-card--${hover.kind}`} style={position}>
      <div className="focus-drift-hover-card__head">
        <span className={`productivity-dot productivity-dot--${hover.kind}`} aria-hidden="true" />
        <div className="focus-drift-hover-card__title">
          <span className="focus-drift-hover-card__eyebrow">{point.label}</span>
          <strong>{verdict}</strong>
        </div>
        <span className="focus-drift-hover-card__window">{formatCompactDurationFromSeconds(point.totalSeconds)} window</span>
      </div>
      <span className="sr-only">{focusDuration} focus · {driftDuration} drift</span>
      <div className="focus-drift-hover-card__metrics" aria-hidden="true">
        {metrics.map((metric) => (
          <div className={`focus-drift-hover-card__metric${metric.kind === hover.kind ? " is-active" : ""}`} key={metric.kind}>
            <strong>{metric.value}</strong>
            <span>{metric.share}</span>
          </div>
        ))}
      </div>
      {point.topFocusSource || point.topDriftSource ? (
        <div className="focus-drift-hover-card__sources" aria-label="Top sources for this window">
          {point.topFocusSource ? <FocusDriftSourceRow appIcons={appIcons} point={point} source={point.topFocusSource} kind="focus" /> : null}
          {point.topDriftSource ? <FocusDriftSourceRow appIcons={appIcons} point={point} source={point.topDriftSource} kind="drift" /> : null}
        </div>
      ) : null}
    </div>
  );
}

function FocusDriftSourceRow({
  appIcons,
  point,
  source,
  kind,
}: {
  readonly appIcons: AppIconMap;
  readonly point: FocusDriftPoint;
  readonly source: FocusDriftSourceSummary;
  readonly kind: FocusDriftHoverKind;
}) {
  const iconSrc = resolveFocusDriftSourceIcon(source, appIcons);
  const sourceDetail = formatFocusDriftSourceDetail(source);
  const sourceShare = formatFocusDriftSourceShare(source, point, kind);

  return (
    <div className={`focus-drift-hover-card__source-row focus-drift-hover-card__source-row--${kind}`}>
      <span className="focus-drift-hover-card__source-icon" aria-hidden="true">
        {source.siteDomain ? (
          <SiteFavicon domain={source.siteDomain} size={24} fallbackIconSrc={iconSrc} />
        ) : (
          <AppGlyph appName={source.appName} iconSrc={iconSrc} size="sm" />
        )}
      </span>
      <div className="focus-drift-hover-card__source-body">
        <div className="focus-drift-hover-card__source-heading">
          <span className="focus-drift-hover-card__source-kind">{SOURCE_KIND_LABELS[kind]}</span>
          <strong>{source.label}</strong>
        </div>
        <em>{sourceDetail}</em>
      </div>
      <strong className="focus-drift-hover-card__source-duration">{sourceShare}</strong>
    </div>
  );
}

function buildFocusDriftMetrics(
  focusDuration: string,
  driftDuration: string,
  focusPercent: string,
  driftPercent: string,
): readonly FocusDriftMetric[] {
  return [
    { kind: "focus", value: `${focusDuration} focus`, share: focusPercent },
    { kind: "drift", value: `${driftDuration} drift`, share: driftPercent },
  ];
}

function resolveFocusDriftSourceIcon(source: FocusDriftSourceSummary, appIcons: AppIconMap): string | null {
  const primaryKey = source.bundleId ?? source.appName;
  return appIcons[primaryKey] ?? appIcons[source.appName] ?? null;
}

function formatFocusDriftSourceDetail(source: FocusDriftSourceSummary): string {
  const surface = source.siteDomain ? `${source.detail} via ${source.appName}` : source.detail;
  const captureLabel = source.captures === 1 ? "capture" : "captures";
  const captures = `${source.captures} ${captureLabel}`;
  return `${surface} · ${formatCompactDurationFromSeconds(source.seconds)} · ${captures}`;
}

function formatFocusDriftSourceShare(
  source: FocusDriftSourceSummary,
  point: FocusDriftPoint,
  kind: FocusDriftHoverKind,
): string {
  const kindSeconds = kind === "focus" ? point.focusSeconds : point.driftSeconds;
  return kindSeconds > 0 ? `${Math.round((source.seconds / kindSeconds) * 100)}%` : "0%";
}

export function formatFocusDriftHoverLabel(point: FocusDriftPoint, kind: FocusDriftHoverKind): string {
  const kindLabel = HOVER_KIND_LABELS[kind];
  const focusPercent = formatSharePercent(point.focusScore);
  const driftPercent = formatSharePercent(point.driftScore);
  const focusDuration = formatDuration(point.focusSeconds);
  const driftDuration = formatDuration(point.driftSeconds);
  const verdict = point.focusScore >= point.driftScore ? "focus-heavy" : "drift-heavy";
  const topFocusSource = point.topFocusSource ? ` Top focus source: ${point.topFocusSource.label}, ${formatCompactDurationFromSeconds(point.topFocusSource.seconds)} across ${point.topFocusSource.captures} ${point.topFocusSource.captures === 1 ? "capture" : "captures"}.` : "";
  const topDriftSource = point.topDriftSource ? ` Top drift source: ${point.topDriftSource.label}, ${formatCompactDurationFromSeconds(point.topDriftSource.seconds)} across ${point.topDriftSource.captures} ${point.topDriftSource.captures === 1 ? "capture" : "captures"}.` : "";

  return `${kindLabel} point for ${point.label}. Focus is ${focusPercent}, ${focusDuration}; drift is ${driftPercent}, ${driftDuration}. This ${point.unit} is ${verdict}.${topFocusSource}${topDriftSource}`;
}
