import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { formatLocalizedCompactDurationFromSeconds, formatLocalizedDuration, formatLocalizedQuarterHourLabel } from "../../lib/formatting";
import type { AppIconMap } from "@drifty/domain";
import type { FocusDriftPoint, FocusDriftSourceSummary } from "./focusDriftChart";
import { getViewportSafeHoverPosition } from "../../components/hoverCardPosition";
import { formatSharePercent } from "./HoverCards";
import type { FocusDriftHoverKind, FocusDriftHoverState } from "./HoverCards";
import { formatFocusDriftWindowRange } from "./focusDriftHoverFormat";
import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useLocalization, type DisplayLanguage } from "../localization/LocalizationContext";

type FocusDriftHoverCardProps = {
  readonly hover: FocusDriftHoverState;
  readonly appIcons: AppIconMap;
  readonly startOfDayMinutes?: number;
};

type HoverCardSize = {
  readonly width: number;
  readonly height: number;
};

type ShareStyle = CSSProperties & { "--focus-drift-share": string };

const HOVER_KIND_LABELS: Record<FocusDriftHoverKind, string> = {
  focus: "Focus",
  drift: "Drift",
};

const HOVER_KINDS: readonly FocusDriftHoverKind[] = ["focus", "drift"];

/**
 * One window of the Focus/Drift chart as two symmetric columns. Each column owns
 * its kind's total and its top source, so no "Top focus source" caption is
 * needed on screen; the caption stays as screen-reader text.
 */
export function FocusDriftHoverCard({ hover, appIcons, startOfDayMinutes = 0 }: FocusDriftHoverCardProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { point } = hover;
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState<HoverCardSize>({ width: 0, height: 0 });
  const focusDuration = formatLocalizedDuration(point.focusSeconds, effectiveLanguage);
  const driftDuration = formatLocalizedDuration(point.driftSeconds, effectiveLanguage);
  const trackedDuration = formatLocalizedCompactDurationFromSeconds(point.trackedSeconds, effectiveLanguage);
  // The verdict names the larger side. Its colour must follow the verdict, not
  // the line under the pointer, or a drift hover on a focus-heavy window pairs
  // a red marker with "Focus-heavy".
  const verdictKind: FocusDriftHoverKind = point.focusScore >= point.driftScore ? "focus" : "drift";
  const verdict = verdictKind === "focus" ? t("dashboard.today.focusHeavy") : t("dashboard.today.driftHeavy");
  // The same clock format as the summary tiles; point.label is the chart's
  // 24-hour bucket key, not a display time.
  const windowRange = formatFocusDriftWindowRange(point.bucketStartMinute, startOfDayMinutes, effectiveLanguage);
  const position = getViewportSafeHoverPosition(hover.x, hover.y, cardSize.width, cardSize.height);
  const hasSources = Boolean(point.topFocusSource || point.topDriftSource);

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
    effectiveLanguage,
    focusDuration,
    point.id,
    point.trackedSeconds,
    point.topDriftSource?.captures,
    point.topDriftSource?.id,
    point.topDriftSource?.seconds,
    point.topFocusSource?.captures,
    point.topFocusSource?.id,
    point.topFocusSource?.seconds,
    verdict,
    windowRange,
  ]);

  return (
    <div ref={cardRef} className={`focus-drift-hover-card focus-drift-hover-card--${hover.kind}`} style={position}>
      <div className="focus-drift-hover-card__head">
        <div className="focus-drift-hover-card__when">
          <strong>{windowRange}</strong>
          <span className={`focus-drift-hover-card__verdict focus-drift-hover-card__verdict--${verdictKind}`}>{verdict}</span>
        </div>
        <span className="focus-drift-hover-card__tracked">{t("dashboard.today.trackedAmount", { duration: trackedDuration })}</span>
      </div>
      <span className="sr-only">{effectiveLanguage !== "en" ? `${focusDuration} ${t("activity.productivity.focus")} · ${driftDuration} ${t("activity.productivity.drift")}` : `${focusDuration} focus · ${driftDuration} drift`}</span>
      <div
        className="focus-drift-hover-card__duo"
        role={hasSources ? "group" : undefined}
        aria-label={hasSources ? t("dashboard.today.topSources") : undefined}
        aria-hidden={hasSources ? undefined : true}
      >
        {HOVER_KINDS.map((kind) => {
          const seconds = kind === "focus" ? point.focusSeconds : point.driftSeconds;
          const score = kind === "focus" ? point.focusScore : point.driftScore;
          const source = kind === "focus" ? point.topFocusSource : point.topDriftSource;
          const shareStyle: ShareStyle = { "--focus-drift-share": `${clampPercent(score)}%` };
          return (
            <div className={`focus-drift-hover-card__col focus-drift-hover-card__col--${kind}${kind === hover.kind ? " is-active" : ""}`} key={kind}>
              <div className="focus-drift-hover-card__metric" aria-hidden="true">
                <span className="focus-drift-hover-card__label">
                  <span className={`productivity-dot productivity-dot--${kind}`} />
                  {t(kind === "focus" ? "activity.productivity.focus" : "activity.productivity.drift")}
                </span>
                <div className="focus-drift-hover-card__value">
                  <strong>{formatLocalizedDuration(seconds, effectiveLanguage)}</strong>
                  <em>{formatSharePercent(score)}</em>
                </div>
                <span className="focus-drift-hover-card__bar"><i style={shareStyle} /></span>
              </div>
              {source ? (
                <FocusDriftSourceBlock appIcons={appIcons} point={point} source={source} kind={kind} language={effectiveLanguage} />
              ) : (
                <div className="focus-drift-hover-card__source focus-drift-hover-card__source--empty" aria-hidden="true">
                  <span>{t(kind === "focus" ? "dashboard.today.noFocusSource" : "dashboard.today.noDriftSource")}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FocusDriftSourceBlock({
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
  const sourceDuration = formatLocalizedCompactDurationFromSeconds(source.seconds, language);

  return (
    <div className={`focus-drift-hover-card__source focus-drift-hover-card__source--${kind}`}>
      <span className="focus-drift-hover-card__source-icon" aria-hidden="true">
        {source.siteDomain ? (
          <SiteFavicon domain={source.siteDomain} size={24} fallbackIconSrc={iconSrc} />
        ) : (
          <AppGlyph appName={source.appName} iconSrc={iconSrc} size="sm" />
        )}
      </span>
      <div className="focus-drift-hover-card__source-body">
        <span className="sr-only">{kind === "focus" ? t("dashboard.today.topFocusSource") : t("dashboard.today.topDriftSource")}</span>
        <strong>{source.label}</strong>
        <span className="focus-drift-hover-card__source-meta" aria-hidden="true">{sourceDuration} · {sourceShare}</span>
        <span className="sr-only">{sourceDetail} · {sourceShare}</span>
      </div>
    </div>
  );
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
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
    ? language === "ko" ? `${detail} · ${source.appName}` : language === "es" ? `${detail} en ${source.appName}` : `${detail} via ${source.appName}`
    : detail;
  const captures = language === "ko" ? `캡처 ${source.captures}개` : language === "es" ? `${source.captures} ${source.captures === 1 ? "captura" : "capturas"}` : `${source.captures} ${source.captures === 1 ? "capture" : "captures"}`;
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
  const kindLabel = language === "ko" ? (kind === "focus" ? "집중" : "딴짓") : language === "es" ? (kind === "focus" ? "concentración" : "distracción") : HOVER_KIND_LABELS[kind];
  const pointLabel = formatLocalizedQuarterHourLabel(point.bucketStartMinute + startOfDayMinutes, language);
  const focusPercent = formatSharePercent(point.focusScore);
  const driftPercent = formatSharePercent(point.driftScore);
  const focusDuration = formatLocalizedDuration(point.focusSeconds, language);
  const driftDuration = formatLocalizedDuration(point.driftSeconds, language);
  const verdict = point.focusScore >= point.driftScore ? (language === "ko" ? "집중 우세" : language === "es" ? "predomina la concentración" : "focus-heavy") : (language === "ko" ? "딴짓 우세" : language === "es" ? "predomina la distracción" : "drift-heavy");
  const trackedDuration = formatLocalizedCompactDurationFromSeconds(point.trackedSeconds, language);
  const topFocusSource = point.topFocusSource ? language === "ko" ? ` 주요 집중 활동: ${point.topFocusSource.label}, ${formatLocalizedCompactDurationFromSeconds(point.topFocusSource.seconds, language)}, 캡처 ${point.topFocusSource.captures}개.` : ` Top focus source: ${point.topFocusSource.label}, ${formatLocalizedCompactDurationFromSeconds(point.topFocusSource.seconds, language)} across ${point.topFocusSource.captures} ${point.topFocusSource.captures === 1 ? "capture" : "captures"}.` : "";
  const topDriftSource = point.topDriftSource ? language === "ko" ? ` 주요 딴짓 활동: ${point.topDriftSource.label}, ${formatLocalizedCompactDurationFromSeconds(point.topDriftSource.seconds, language)}, 캡처 ${point.topDriftSource.captures}개.` : ` Top drift source: ${point.topDriftSource.label}, ${formatLocalizedCompactDurationFromSeconds(point.topDriftSource.seconds, language)} across ${point.topDriftSource.captures} ${point.topDriftSource.captures === 1 ? "capture" : "captures"}.` : "";

  if (language === "ko") {
    return `${pointLabel} ${kindLabel} 지점. 집중 ${focusPercent}, ${focusDuration}; 딴짓 ${driftPercent}, ${driftDuration}; 기록 시간 ${trackedDuration}. 이 구간은 ${verdict}입니다.${topFocusSource}${topDriftSource}`;
  }
  if (language === "es") {
    const focusSource = point.topFocusSource ? ` Principal actividad de concentración: ${point.topFocusSource.label}, ${formatLocalizedCompactDurationFromSeconds(point.topFocusSource.seconds, language)} en ${point.topFocusSource.captures} capturas.` : "";
    const driftSource = point.topDriftSource ? ` Principal actividad de distracción: ${point.topDriftSource.label}, ${formatLocalizedCompactDurationFromSeconds(point.topDriftSource.seconds, language)} en ${point.topDriftSource.captures} capturas.` : "";
    return `${kindLabel} a las ${pointLabel}. Concentración: ${focusPercent}, ${focusDuration}; distracción: ${driftPercent}, ${driftDuration}; tiempo registrado: ${trackedDuration}. ${verdict}.${focusSource}${driftSource}`;
  }
  return `${kindLabel} point for ${pointLabel}. Focus is ${focusPercent}, ${focusDuration}; drift is ${driftPercent}, ${driftDuration}; tracked time is ${trackedDuration}. This ${point.unit} is ${verdict}.${topFocusSource}${topDriftSource}`;
}
