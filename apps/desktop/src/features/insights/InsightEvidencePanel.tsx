import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ActivitySegment, AppIconMap, ClassificationOptions } from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { formatLocalizedCompactDurationFromSeconds, formatLocalizedCompactTimeRange, formatLocalizedDayLabel, formatLocalizedTimeLabel } from "../../lib/formatting";
import { localizedCategoryLabel } from "../localization/activityTranslations";
import { useLocalization } from "../localization/LocalizationContext";
import { INSIGHT_EVIDENCE_PANEL_ID, buildInsightEvidence, type InsightEvidenceRecord, type InsightEvidenceSurface, type InsightEvidenceSwitch, type InsightEvidenceTarget } from "./insightEvidence";
import type { InsightSourceItem } from "./insightData";

/** Rows rendered before "Show more": enough for a week of one app without a long first paint on 90 days. */
const EVIDENCE_PAGE_SIZE = 60;

type InsightEvidencePanelProps = {
  readonly target: InsightEvidenceTarget;
  /** The clicked row as it was, kept so the header still reads right after the range moves on. */
  readonly item: InsightSourceItem;
  readonly listLabel: string;
  readonly rangeLabel: string;
  readonly segments: readonly ActivitySegment[];
  readonly classificationOptions: ClassificationOptions;
  readonly startOfDayMinutes: number;
  readonly appIcons: AppIconMap;
  readonly autoFocus: boolean;
  readonly motion: "open" | "switch";
  readonly onAutoFocused?: () => void;
  readonly onClose: () => void;
};

function SurfaceIcon({ surface, appIcons, size }: { readonly surface: Pick<InsightEvidenceSurface, "appName" | "bundleId" | "siteDomain" | "label">; readonly appIcons: AppIconMap; readonly size: number }) {
  const iconSrc = appIcons[surface.bundleId ?? surface.appName] ?? null;
  return surface.siteDomain
    ? <SiteFavicon domain={surface.siteDomain} size={size} fallbackIconSrc={iconSrc} />
    : <AppGlyph appName={surface.label} iconSrc={iconSrc} size="sm" />;
}

export function InsightEvidencePanel({
  target,
  item,
  listLabel,
  rangeLabel,
  segments,
  classificationOptions,
  startOfDayMinutes,
  appIcons,
  autoFocus,
  motion,
  onAutoFocused,
  onClose,
}: InsightEvidencePanelProps) {
  const { effectiveLanguage, t } = useLocalization();
  const backRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [limit, setLimit] = useState(EVIDENCE_PAGE_SIZE);
  // How these records arrived is decided once; later prop changes must not replay an animation.
  const [arrivalMotion] = useState(motion);
  const evidence = useMemo(
    () => buildInsightEvidence(segments, target, item, classificationOptions, startOfDayMinutes),
    [classificationOptions, item, segments, startOfDayMinutes, target],
  );
  const tone = target.variant === "drift" ? "var(--productivity-drift)" : "var(--productivity-focus)";
  const titleId = `${INSIGHT_EVIDENCE_PANEL_ID}-title`;

  // In a narrow window the column sits below the lists, so bring the records
  // into view before moving focus there; a wide window needs no scrolling.
  useEffect(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    panelRef.current?.scrollIntoView?.({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
    if (!autoFocus) return;
    backRef.current?.focus({ preventScroll: true });
    onAutoFocused?.();
    // Only the first render of these records decides; a later prop change must not move focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A different range starts at the top of its own list.
  useEffect(() => {
    setLimit(EVIDENCE_PAGE_SIZE);
    listRef.current?.scrollTo?.({ top: 0 });
  }, [rangeLabel]);

  const entryCount = evidence.kind === "records" ? evidence.recordCount : evidence.count;
  // When every record shares one category, say it once instead of on each line.
  const sharedCategory = useMemo(() => {
    if (evidence.kind !== "records") return null;
    const categories = new Set(evidence.days.flatMap((day) => day.entries.map((record) => record.category)));
    return categories.size === 1 ? [...categories][0] ?? null : null;
  }, [evidence]);
  const valueLabel = evidence.kind === "switches"
    ? (effectiveLanguage === "ko" ? `${evidence.count}회` : `${evidence.count}x`)
    : formatLocalizedCompactDurationFromSeconds(evidence.totalSeconds, effectiveLanguage);
  const detailLabel = evidence.kind === "records"
    ? [
      evidence.recordCount === 1 ? t("trends.evidence.recordCountSingle") : t("trends.evidence.recordCount", { count: evidence.recordCount }),
      sharedCategory ? localizedCategoryLabel(sharedCategory, t) : null,
    ].filter(Boolean).join(" · ")
    : t("trends.evidence.switchTotal", { duration: formatLocalizedCompactDurationFromSeconds(evidence.totalSeconds, effectiveLanguage) });

  let remaining = limit;
  const shown = evidence.days.map((day) => {
    const entries = day.entries.slice(0, Math.max(0, remaining));
    remaining -= entries.length;
    return { ...day, entries, entryCount: day.entries.length };
  }).filter((day) => day.entries.length > 0);
  const hiddenCount = Math.max(0, entryCount - limit);

  return (
    <section
      ref={panelRef}
      id={INSIGHT_EVIDENCE_PANEL_ID}
      className="editorial-panel editorial-panel--soft insight-evidence"
      data-motion={arrivalMotion}
      style={{ "--trend-tone": tone } as CSSProperties}
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        onClose();
      }}
    >
      <div className="insight-evidence__top">
        <button ref={backRef} type="button" className="insight-evidence__back" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m10 3.5-4.5 4.5 4.5 4.5" /></svg>
          <span>{t("trends.evidence.back")}</span>
        </button>
      </div>
      <header className="insight-evidence__head">
        <span className="insight-evidence__icon" aria-hidden="true">
          <SurfaceIcon surface={item} appIcons={appIcons} size={22} />
        </span>
        <div className="insight-evidence__heading">
          <h2 id={titleId} title={item.label}>{item.label}</h2>
          <p>{listLabel} · {rangeLabel}</p>
        </div>
      </header>
      {entryCount > 0 ? (
        <div className="insight-evidence__summary" aria-live="polite">
          <strong>{valueLabel}</strong>
          <span>{detailLabel}</span>
        </div>
      ) : <div className="insight-evidence__summary insight-evidence__summary--empty" aria-hidden="true" />}
      <div className="insight-evidence__list" ref={listRef} tabIndex={-1}>
        {entryCount === 0 ? (
          <p className="insight-evidence__empty">{t("trends.evidence.empty")}</p>
        ) : shown.map((day) => (
          <section className="insight-evidence__day" key={day.dayKey} aria-label={formatLocalizedDayLabel(day.dayKey, effectiveLanguage)}>
            <h3>
              <span>{formatLocalizedDayLabel(day.dayKey, effectiveLanguage)}</span>
              {/* A day with one record would repeat that record's time; the total only adds something for two or more. */}
              {day.entryCount > 1 ? (
                <span className="insight-evidence__day-total">{formatLocalizedCompactDurationFromSeconds(day.totalSeconds, effectiveLanguage)}</span>
              ) : null}
            </h3>
            <ol>
              {evidence.kind === "records"
                ? (day.entries as readonly InsightEvidenceRecord[]).map((record) => (
                  <li className="insight-evidence__entry" key={record.id}>
                    <span className="insight-evidence__entry-title" title={record.title}>{record.title}</span>
                    <span className="insight-evidence__entry-value">{formatLocalizedCompactDurationFromSeconds(record.durationSeconds, effectiveLanguage)}</span>
                    <span className="insight-evidence__entry-meta">
                      <span>{formatLocalizedCompactTimeRange(record.startedAt, record.endedAt, effectiveLanguage)}</span>
                      {sharedCategory ? null : (
                        <>
                          <span className={`category-dot category-dot--${record.category}`} aria-hidden="true" />
                          <span>{localizedCategoryLabel(record.category, t)}</span>
                        </>
                      )}
                    </span>
                  </li>
                ))
                : (day.entries as readonly InsightEvidenceSwitch[]).map((entry) => {
                  const subject = target.variant === "drift" ? entry.to : entry.from;
                  return (
                    <li className="insight-evidence__entry insight-evidence__entry--switch" key={entry.id}>
                      <span className="insight-evidence__switch">
                        <span className="insight-evidence__switch-side" title={entry.from.label}>
                          <SurfaceIcon surface={entry.from} appIcons={appIcons} size={16} />
                          <span>{entry.from.label}</span>
                        </span>
                        <svg className="insight-evidence__switch-arrow" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>
                        <span className="sr-only">{effectiveLanguage === "ko" ? "에서" : "to"}</span>
                        <span className="insight-evidence__switch-side" title={entry.to.label}>
                          <SurfaceIcon surface={entry.to} appIcons={appIcons} size={16} />
                          <span>{entry.to.label}</span>
                        </span>
                      </span>
                      <span className="insight-evidence__entry-value">{formatLocalizedCompactDurationFromSeconds(entry.durationSeconds, effectiveLanguage)}</span>
                      <span className="insight-evidence__entry-meta">
                        <span>{formatLocalizedTimeLabel(entry.at, effectiveLanguage)}</span>
                        {subject.title && subject.title !== subject.label ? <span className="insight-evidence__entry-detail" title={subject.title}>{subject.title}</span> : null}
                      </span>
                    </li>
                  );
                })}
            </ol>
          </section>
        ))}
        {hiddenCount > 0 ? (
          <button type="button" className="insight-evidence__more" onClick={() => setLimit((current) => current + EVIDENCE_PAGE_SIZE)}>
            {t("trends.evidence.showMore", { count: Math.min(hiddenCount, EVIDENCE_PAGE_SIZE) })}
          </button>
        ) : null}
      </div>
    </section>
  );
}
