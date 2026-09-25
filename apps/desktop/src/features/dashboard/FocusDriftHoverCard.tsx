import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { formatLocalizedCompactDurationFromSeconds, formatLocalizedDuration, formatLocalizedQuarterHourLabel } from "../../lib/formatting";
import type { AppIconMap } from "@drifty/domain";
import type { FocusDriftPoint, FocusDriftSourceSummary } from "./focusDriftChart";
import { getViewportSafeHoverPosition } from "../../components/hoverCardPosition";
import { formatSharePercent } from "./HoverCards";
import type { FocusDriftHoverKind, FocusDriftHoverState } from "./HoverCards";
import { useLayoutEffect, useRef, useState } from "react";
import { useLocalization, type DisplayLanguage } from "../localization/LocalizationContext";

type FocusDriftHoverCardProps = {
  readonly hover: FocusDriftHoverState;
  readonly appIcons: AppIconMap;
  readonly startOfDayMinutes?: number;
};

type FocusDriftMetric = {
  readonly kind: FocusDriftHoverKind;
  readonly value: string;
  readonly share: string;
};

type HoverCardSize = {
  readonly width: number;
  readonly height: number;
};

const HOVER_KIND_LABELS: Record<FocusDriftHoverKind, string> = {
  focus: "Focus",
  drift: "Drift",
};

export function FocusDriftHoverCard({ hover, appIcons, startOfDayMinutes = 0 }: FocusDriftHoverCardProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { point } = hover;
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState<HoverCardSize>({ width: 0, height: 0 });
  const focusPercent = formatSharePercent(point.focusScore);
  const driftPercent = formatSharePercent(point.driftScore);
  const focusDuration = formatLocalizedDuration(point.focusSeconds, effectiveLanguage);
  const driftDuration = formatLocalizedDuration(point.driftSeconds, effectiveLanguage);
  const trackedDuration = formatLocalizedCompactDurationFromSeconds(point.trackedSeconds, effectiveLanguage);
  const isFocusHeavy = point.focusScore >= point.driftScore;
  const verdict = isFocusHeavy ? t("dashboard.today.focusHeavy") : t("dashboard.today.driftHeavy");
  const metrics = buildFocusDriftMetrics(focusDuration, driftDuration, focusPercent, driftPercent, effectiveLanguage);
  // The same clock format as the summary tiles; point.label is the chart's
  // 24-hour bucket key, not a display time.
  const pointLabel = formatLocalizedQuarterHourLabel(point.bucketStartMinute + startOfDayMinutes, effectiveLanguage);
  const position = getViewportSafeHoverPosition(hover.x, hover.y, cardSize.width, cardSize.height);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return undefined;
    const currentCard = card;

    function updateCardSize() {
      const bounds = currentCard.getBoundingClientRect();
      setCardSize((currentSize) => (
        currentSize.width === bounds.width && currentSize.height === bounds.height
          ? currentSize
          : { width: bounds.width, height: bounds.height }
      ));
    }

    updateCardSize();
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(updateCardSize) : null;
    resizeObserver?.observe(currentCard);
    window.addEventListener("resize", updateCardSize);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateCardSize);
    };
  }, [
    driftDuration,
    driftPercent,
    focusDuration,
    focusPercent,
    point.id,
    pointLabel,
    point.trackedSeconds,
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
          <span className="focus-drift-hover-card__eyebrow">{pointLabel}</span>
          <strong>{verdict}</strong>
        </div>
        <span className="focus-drift-hover-card__window">{t("dashboard.today.trackedAmount", { duration: trackedDuration })}</span>
      </div>
      <span className="sr-only">{effectiveLanguage === "ko" ? `${focusDuration} ${t("activity.productivity.focus")} · ${driftDuration} ${t("activity.productivity.drift")}` : `${focusDuration} focus · ${driftDuration} drift`}</span>
      <div className="focus-drift-hover-card__metrics" aria-hidden="true">
        {metrics.map((metric) => (
          <div className={`focus-drift-hover-card__metric${metric.kind === hover.kind ? " is-active" : ""}`} key={metric.kind}>
            <strong>{metric.value}</strong>
            <span>{metric.share}</span>
          </div>
        ))}
      </div>
      {point.topFocusSource || point.topDriftSource ? (
        <div className="focus-drift-hover-card__sources" aria-label={t("dashboard.today.topSources")}>
          {point.topFocusSource ? <FocusDriftSourceRow appIcons={appIcons} point={point} source={point.topFocusSource} kind="focus" language={effectiveLanguage} /> : null}
          {point.topDriftSource ? <FocusDriftSourceRow appIcons={appIcons} point={point} source={point.topDriftSource} kind="drift" language={effectiveLanguage} /> : null}
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
  language,
}: {
  readonly appIcons: AppIconMap;
  readonly point: FocusDriftPoint;
  readonly source: FocusDriftSourceSummary;
  readonly kind: FocusDriftHoverKind;
  readonly language: DisplayLanguage;
}) {
  const { t } = useLocalization();
  const iconSrc = resolveFocusDriftSourceIcon(source, appIcons);
  const sourceDetail = formatFocusDriftSourceDetail(source, language, t);
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
          <span className="focus-drift-hover-card__source-kind">{kind === "focus" ? t("dashboard.today.topFocusSource") : t("dashboard.today.topDriftSource")}</span>
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
  language: DisplayLanguage,
): readonly FocusDriftMetric[] {
  const labels = language === "ko" ? { focus: "집중", drift: "딴짓" } : { focus: "focus", drift: "drift" };
  return [
    { kind: "focus", value: `${focusDuration} ${labels.focus}`, share: focusPercent },
    { kind: "drift", value: `${driftDuration} ${labels.drift}`, share: driftPercent },
  ];
}

function resolveFocusDriftSourceIcon(source: FocusDriftSourceSummary, appIcons: AppIconMap): string | null {
  const primaryKey = source.bundleId ?? source.appName;
  return appIcons[primaryKey] ?? appIcons[source.appName] ?? null;
}

function formatFocusDriftSourceDetail(source: FocusDriftSourceSummary, language: DisplayLanguage, t: ReturnType<typeof useLocalization>["t"]): string {
  const detail = source.detail === "Desktop app"
    ? t("dashboard.today.desktopApp")
    : source.detail === "Website"
      ? t("dashboard.today.website")
      : source.detail;
  const surface = source.siteDomain
    ? language === "ko" ? `${detail} · ${source.appName}` : `${detail} via ${source.appName}`
    : detail;
  const captures = language === "ko" ? `캡처 ${source.captures}개` : `${source.captures} ${source.captures === 1 ? "capture" : "captures"}`;
  return `${surface} · ${formatLocalizedCompactDurationFromSeconds(source.seconds, language)} · ${captures}`;
}

function formatFocusDriftSourceShare(
  source: FocusDriftSourceSummary,
  point: FocusDriftPoint,
  kind: FocusDriftHoverKind,
): string {
  const kindSeconds = kind === "focus" ? point.focusSeconds : point.driftSeconds;
  return kindSeconds > 0 ? `${Math.round((source.seconds / kindSeconds) * 100)}%` : "0%";
}

export function formatFocusDriftHoverLabel(point: FocusDriftPoint, kind: FocusDriftHoverKind, language: DisplayLanguage = "en", startOfDayMinutes = 0): string {
  const kindLabel = language === "ko" ? (kind === "focus" ? "집중" : "딴짓") : HOVER_KIND_LABELS[kind];
  const pointLabel = formatLocalizedQuarterHourLabel(point.bucketStartMinute + startOfDayMinutes, language);
  const focusPercent = formatSharePercent(point.focusScore);
  const driftPercent = formatSharePercent(point.driftScore);
  const focusDuration = formatLocalizedDuration(point.focusSeconds, language);
  const driftDuration = formatLocalizedDuration(point.driftSeconds, language);
  const verdict = point.focusScore >= point.driftScore ? (language === "ko" ? "집중 우세" : "focus-heavy") : (language === "ko" ? "딴짓 우세" : "drift-heavy");
  const trackedDuration = formatLocalizedCompactDurationFromSeconds(point.trackedSeconds, language);
  const topFocusSource = point.topFocusSource ? language === "ko" ? ` 주요 집중 활동: ${point.topFocusSource.label}, ${formatLocalizedCompactDurationFromSeconds(point.topFocusSource.seconds, language)}, 캡처 ${point.topFocusSource.captures}개.` : ` Top focus source: ${point.topFocusSource.label}, ${formatLocalizedCompactDurationFromSeconds(point.topFocusSource.seconds, language)} across ${point.topFocusSource.captures} ${point.topFocusSource.captures === 1 ? "capture" : "captures"}.` : "";
  const topDriftSource = point.topDriftSource ? language === "ko" ? ` 주요 딴짓 활동: ${point.topDriftSource.label}, ${formatLocalizedCompactDurationFromSeconds(point.topDriftSource.seconds, language)}, 캡처 ${point.topDriftSource.captures}개.` : ` Top drift source: ${point.topDriftSource.label}, ${formatLocalizedCompactDurationFromSeconds(point.topDriftSource.seconds, language)} across ${point.topDriftSource.captures} ${point.topDriftSource.captures === 1 ? "capture" : "captures"}.` : "";

  if (language === "ko") {
    return `${pointLabel} ${kindLabel} 지점. 집중 ${focusPercent}, ${focusDuration}; 딴짓 ${driftPercent}, ${driftDuration}; 기록 시간 ${trackedDuration}. 이 구간은 ${verdict}입니다.${topFocusSource}${topDriftSource}`;
  }
  return `${kindLabel} point for ${pointLabel}. Focus is ${focusPercent}, ${focusDuration}; drift is ${driftPercent}, ${driftDuration}; tracked time is ${trackedDuration}. This ${point.unit} is ${verdict}.${topFocusSource}${topDriftSource}`;
}
