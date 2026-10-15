import {
  type ActivityCategory,
  type AppIconMap,
  type ClassificationOptions,
  type ProductivityLabel,
} from "@drifty/domain";
import type { ClassificationCorrectionDraft, ClassificationCorrectionNotice } from "./classificationCorrection";
import { useEffect, useRef, useState } from "react";
import { AppGlyph } from "../../components/AppGlyph";
import { DateNavigator } from "../../components/DateNavigator";
import { NavChevronIcon } from "../../components/NavChevronIcon";
import { SiteFavicon } from "../../components/SiteFavicon";
import { CATEGORY_COLORS } from "../../lib/activityLabels";
import { formatLocalizedCompactDurationFromSeconds, formatLocalizedCompactTimeRange, formatLocalizedDuration, formatLocalizedShortDurationFromSeconds, formatLocalizedTimeLabel } from "../../lib/formatting";
import type { ClassificationRange } from "../dashboard/dashboardPeriods";
import {
  CLASSIFICATION_FOCUS_RATE_DESCRIPTION,
  CLASSIFICATION_FOCUS_RATE_LABEL,
} from "./classificationFocusRate";
import type { ClassificationPanelStyle } from "./ClassificationBreakdownCards";
import { ClassificationCorrectionPopover } from "./ClassificationCorrectionPopover";
import {
  buildCaptureSliceGroups,
  captureRowSurfaceDetails,
  classificationActivityDetailsId,
  classificationActivityLabel,
  classificationRowSummary,
  classifySourceKey,
  type ClassificationActivityRow,
  type ClassificationCategoryBreakdown,
  type ClassificationSourceSummary,
} from "./classificationViewData";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import { localizedCategoryLabel, localizedProductivityLabel } from "../localization/activityTranslations";

type ClassificationPageProps = {
  readonly appIcons: AppIconMap;
  readonly canShiftClassificationForward: boolean;
  readonly classificationActivityPeakSeconds: number;
  readonly classificationActivityRows: ClassificationActivityRow[];
  readonly classificationCategoryBreakdowns: ClassificationCategoryBreakdown[];
  readonly classificationDateLabel: string;
  readonly classificationOptions: ClassificationOptions;
  readonly classificationPanelStyle: ClassificationPanelStyle;
  readonly classificationFocusRatePercent: number;
  readonly classificationRange: ClassificationRange;
  readonly classificationSessionCount: number;
  readonly classificationSourceSummaries: ClassificationSourceSummary[];
  readonly classificationTopAppIconSrc: string | null;
  readonly classificationTopAppLabel: string;
  readonly classificationTopAppName: string;
  readonly classificationTotalSeconds: number;
  readonly effectiveClassifyCategoryId: ActivityCategory | null;
  readonly effectiveClassifySourceId: string | null;
  readonly expandedClassificationActivityRows: ReadonlySet<string>;
  readonly isCurrentClassificationRange: boolean;
  readonly devModeEnabled: boolean;
  readonly classificationCorrectionDraft: ClassificationCorrectionDraft | null;
  readonly classificationCorrectionNotice: ClassificationCorrectionNotice | null;
  readonly classificationCorrectionSaving: boolean;
  readonly selectedClassificationBreakdown: ClassificationCategoryBreakdown | null;
  readonly selectedClassificationSourceSummary: ClassificationSourceSummary | null;
  readonly selectedClassificationTone: string;
  readonly onActivityRowToggle: (rowId: string) => void;
  readonly onCategorySelect: (category: ActivityCategory) => void;
  readonly onCancelClassificationCorrection: () => void;
  readonly onClassificationCorrectionCategoryChange: (category: ActivityCategory) => void;
  readonly onClassificationCorrectionProductivityChange: (productivity: ProductivityLabel) => void;
  readonly onNextClassificationRange: () => void;
  readonly onPreviousClassificationRange: () => void;
  readonly onRangeChange: (range: ClassificationRange) => void;
  readonly onSaveClassificationCorrection: () => void;
  readonly onSourceSelect: (sourceId: string) => void;
  readonly onStartClassificationDetailCorrection: (rowId: string) => void;
  readonly onStartClassificationSurfaceCorrection: () => void;
  readonly onTodayClassificationRange: () => void;
};

function ClassificationEditGlyph() {
  return (
    <svg className="classification-correction__edit-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M10.5 2.5l3 3L6 13l-3.5.5.5-3.5z" />
    </svg>
  );
}

function ClassificationCheckGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

function localizedCorrectionDetailLabel(
  detailKind: ClassificationCorrectionDraft["detailKind"],
  t: LocalizationController["t"],
): string {
  switch (detailKind) {
    case "title": return t("settings.classification.title");
    case "windowTitle": return t("settings.classification.windowTitle");
    case "siteTitle": return t("settings.classification.pageTitle");
    case "youtubeTitle": return t("settings.classification.youtubeTitle");
    case "siteUrl": return "URL";
    default: return t("settings.classification.detail");
  }
}

/**
 * The same label inside a sentence ("This window title only"). English field
 * labels are title-cased; proper nouns and acronyms keep their capitals.
 */
function inlineCorrectionDetailLabel(
  detailKind: ClassificationCorrectionDraft["detailKind"],
  t: LocalizationController["t"],
  language: string,
): string {
  const label = localizedCorrectionDetailLabel(detailKind, t);
  if (language !== "en" || detailKind === "youtubeTitle" || detailKind === "siteUrl") return label;
  return label.charAt(0).toLocaleLowerCase("en") + label.slice(1);
}

function localizeClassificationSummaryValue(value: string, language: "en" | "ko"): string {
  if (language === "en") return value;
  const labels: Readonly<Record<string, string>> = {
    Mixed: "혼합",
    Workspace: "작업",
    Learning: "학습",
    Communication: "커뮤니케이션",
    Music: "음악",
    Game: "게임",
    "Social media": "소셜 미디어",
    Entertainment: "엔터테인먼트",
    Shopping: "쇼핑",
    Utility: "유틸리티",
    Unclassified: "미분류",
    Focus: "집중",
    Drift: "딴짓",
    Neutral: "중립",
    "Confidence unavailable": "신뢰도 정보 없음",
    "Mixed confidence": "신뢰도 혼합",
    "AI cache": "AI 캐시",
    Predefined: "기본 규칙",
    "Keyword rule": "키워드 규칙",
    Fallback: "기본값",
    Manual: "수동",
    "Custom rule": "사용자 규칙",
    Stored: "저장됨",
    "Not classified yet": "아직 미분류",
  };
  return labels[value] ?? value;
}

function localizeCaptureSurfaceDetail(value: string, language: "en" | "ko"): string {
  if (language === "en") return value;
  return value
    .replace(/^App:/u, "앱:")
    .replace(/^Browser:/u, "브라우저:")
    .replace(/^Domain:/u, "도메인:")
    .replace(/^Channel:/u, "채널:");
}

export function ClassificationPage({
  appIcons,
  canShiftClassificationForward,
  classificationActivityPeakSeconds,
  classificationActivityRows,
  classificationCategoryBreakdowns,
  classificationDateLabel,
  classificationOptions,
  classificationPanelStyle,
  classificationFocusRatePercent,
  classificationRange,
  classificationSessionCount,
  classificationSourceSummaries,
  classificationTopAppIconSrc,
  classificationTopAppLabel,
  classificationTopAppName,
  classificationTotalSeconds,
  effectiveClassifyCategoryId,
  effectiveClassifySourceId,
  expandedClassificationActivityRows,
  isCurrentClassificationRange,
  devModeEnabled,
  classificationCorrectionDraft,
  classificationCorrectionNotice,
  classificationCorrectionSaving,
  selectedClassificationBreakdown,
  selectedClassificationSourceSummary,
  selectedClassificationTone,
  onActivityRowToggle,
  onCategorySelect,
  onCancelClassificationCorrection,
  onClassificationCorrectionCategoryChange,
  onClassificationCorrectionProductivityChange,
  onNextClassificationRange,
  onPreviousClassificationRange,
  onRangeChange,
  onSaveClassificationCorrection,
  onSourceSelect,
  onStartClassificationDetailCorrection,
  onStartClassificationSurfaceCorrection,
  onTodayClassificationRange,
}: ClassificationPageProps) {
  const { effectiveLanguage, t } = useLocalization();
  const sourceMetaLabel = (item: { readonly sessionCount: number; readonly averageSessionSeconds: number }) => `${item.sessionCount === 1 ? t("classification.sessionCountOne") : t("classification.sessionCount", { count: item.sessionCount })} · ${t("classification.averageValue", { duration: formatLocalizedCompactDurationFromSeconds(item.averageSessionSeconds, effectiveLanguage) })}`;
  const surfaceCorrectionButtonRef = useRef<HTMLButtonElement | null>(null);
  const detailCorrectionButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const [recentlyCorrectedRowId, setRecentlyCorrectedRowId] = useState<string | null>(null);
  const lastDraftRef = useRef<ClassificationCorrectionDraft | null>(null);

  useEffect(() => {
    if (classificationCorrectionDraft) lastDraftRef.current = classificationCorrectionDraft;
  }, [classificationCorrectionDraft]);

  // After a successful save, briefly mark the row (or header) that just changed so
  // the eye lands where the correction applied.
  useEffect(() => {
    if (classificationCorrectionNotice?.kind !== "success") return;
    const settled = lastDraftRef.current;
    const rowId = settled && settled.scope !== "surface" ? settled.rowId : "__surface__";
    setRecentlyCorrectedRowId(rowId ?? null);
    const timer = window.setTimeout(() => {
      setRecentlyCorrectedRowId(null);
      lastDraftRef.current = null;
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [classificationCorrectionNotice]);

  const registerDetailCorrectionButton = (rowId: string) => (element: HTMLButtonElement | null) => {
    if (element) detailCorrectionButtonRefs.current.set(rowId, element);
    else detailCorrectionButtonRefs.current.delete(rowId);
  };

  const renderClassificationCorrectionPopover = () => {
    if (!classificationCorrectionDraft || !selectedClassificationSourceSummary) return null;
    const draft = classificationCorrectionDraft;
    const isDetailCorrection = draft.scope === "detail";
    const isRecordsCorrection = draft.scope === "records";
    const isRowCorrection = draft.scope !== "surface";
    const correctedRow = draft.rowId ? classificationActivityRows.find((row) => row.id === draft.rowId) ?? null : null;
    const anchorElement = isRowCorrection
      ? (draft.rowId ? detailCorrectionButtonRefs.current.get(draft.rowId) ?? null : null)
      : surfaceCorrectionButtonRef.current;
    const targetLabel = draft.displayLabel ?? draft.targetValue;
    const detailKindLabel = inlineCorrectionDetailLabel(draft.detailKind, t, effectiveLanguage);
    const surfaceKindLabel = t(selectedClassificationSourceSummary.usageKind === "site" ? "classification.domain" : "classification.app");
    const recordCount = correctedRow?.count ?? 0;
    const scopeDescription = isRecordsCorrection
      ? t("classification.correction.recordsScope", { count: recordCount })
      : isDetailCorrection
        ? t("classification.correction.detailScope", { detail: detailKindLabel })
        : t("classification.correction.surfaceScope", { target: targetLabel });
    const scopeBadge = isRecordsCorrection
      ? t("classification.correction.recordsBadge")
      : isDetailCorrection
        ? t("classification.correction.detailBadge", { detail: detailKindLabel })
        : t("classification.correction.surfaceBadge", { surface: surfaceKindLabel });
    const title = isRecordsCorrection
      ? t("classification.unidentifiedActivity")
      : isDetailCorrection
        ? (draft.detailValue && draft.detailValue !== targetLabel ? draft.detailValue : targetLabel)
        : selectedClassificationSourceSummary.label;
    const identity = selectedClassificationSourceSummary.usageKind === "site" && selectedClassificationSourceSummary.siteDomain
      ? <SiteFavicon domain={selectedClassificationSourceSummary.siteDomain} size={18} fallbackIconSrc={appIcons[selectedClassificationSourceSummary.appName] ?? null} />
      : <AppGlyph appName={selectedClassificationSourceSummary.usageKind === "site" ? selectedClassificationSourceSummary.label : selectedClassificationSourceSummary.appName} iconSrc={appIcons[selectedClassificationSourceSummary.appName] ?? null} size="sm" />;

    return (
      <ClassificationCorrectionPopover
        anchorElement={anchorElement}
        draft={draft}
        notice={classificationCorrectionNotice}
        saving={classificationCorrectionSaving}
        identity={identity}
        title={title}
        scopeBadge={scopeBadge}
        scopeDescription={scopeDescription}
        ariaLabel={t(isRecordsCorrection ? "classification.correction.recordsAria" : isDetailCorrection ? "classification.correction.detailAria" : "classification.correction.surfaceAria")}
        originalCategory={draft.originalCategory}
        originalProductivity={draft.originalProductivity}
        t={t}
        onCategoryChange={onClassificationCorrectionCategoryChange}
        onProductivityChange={onClassificationCorrectionProductivityChange}
        onSave={onSaveClassificationCorrection}
        onCancel={onCancelClassificationCorrection}
      />
    );
  };

  const renderCorrectionNotice = () => classificationCorrectionNotice?.kind === "success" ? (
    <div className="classification-correction-result" role="status">
      <ClassificationCheckGlyph />
      <span>{classificationCorrectionNotice.message}</span>
    </div>
  ) : null;

  const firstSource = classificationSourceSummaries[0];
  const firstSourceKey = firstSource ? classifySourceKey(firstSource) : null;
  const alternateRange: ClassificationRange = classificationRange === "Day" ? "Week" : "Day";

  return (
    <div className="page">
      <div className="pg-head">
        <div>
          <h1>{t("classification.title")}</h1>
        </div>
        <div className="classification-range-controls">
          <div className="settings-mode-switch" role="radiogroup" aria-label={t("classification.rangeAria")}>
            {(["Day", "Week"] as const).map((range) => (
              <button
                key={range}
                type="button"
                className={`settings-mode-option${classificationRange === range ? " is-active" : ""}`}
                role="radio"
                aria-checked={classificationRange === range}
                onClick={() => onRangeChange(range)}
              >
                <span>{t(range === "Day" ? "common.day" : "common.week")}</span>
              </button>
            ))}
          </div>
          <DateNavigator
            ariaLabel={t("classification.dateSelector", { range: t(classificationRange === "Day" ? "common.day" : "common.week") })}
            label={classificationDateLabel}
            todayLabel={t("common.now")}
            todayActionLabel={effectiveLanguage === "ko" ? t(classificationRange === "Week" ? "classification.goCurrent" : "classification.goToday") : undefined}
            isTodayDisabled={isCurrentClassificationRange}
            isNextDisabled={!canShiftClassificationForward}
            onPrevious={onPreviousClassificationRange}
            onNext={onNextClassificationRange}
            onToday={onTodayClassificationRange}
            previousLabel={t(classificationRange === "Week" ? "classification.previousWeek" : "classification.previousDay")}
            nextLabel={t(classificationRange === "Week" ? "classification.nextWeek" : "classification.nextDay")}
          />
        </div>
      </div>

      <div className="clf-summary">
        <div className="clf-stat"><span className="eyebrow">{t("common.total")}</span><strong>{formatLocalizedDuration(classificationTotalSeconds, effectiveLanguage)}</strong></div>
        <div className="clf-stat"><span className="eyebrow">{t("common.sessions")}</span><strong>{classificationSessionCount}</strong></div>
        <div className="clf-stat clf-stat--with-icon">
          <span className="eyebrow">{t("classification.topApp")}</span>
          <div className="clf-stat__row">
            <AppGlyph appName={classificationTopAppName} iconSrc={classificationTopAppIconSrc} size="sm" />
            <strong title={classificationTopAppLabel}>{classificationTopAppLabel}</strong>
          </div>
        </div>
        <div
          className="clf-stat"
          role="group"
          aria-label={`${effectiveLanguage === "ko" ? t("classification.focusRate") : CLASSIFICATION_FOCUS_RATE_LABEL}, ${effectiveLanguage === "ko" ? t("classification.focusRateDescription") : CLASSIFICATION_FOCUS_RATE_DESCRIPTION}`}
          title={effectiveLanguage === "ko" ? t("classification.focusRateDescription") : CLASSIFICATION_FOCUS_RATE_DESCRIPTION}
        >
          <span className="eyebrow">{effectiveLanguage === "ko" ? t("classification.focusRate") : CLASSIFICATION_FOCUS_RATE_LABEL}</span>
          <strong>{classificationFocusRatePercent}%</strong>
        </div>
      </div>

      {classificationCategoryBreakdowns.length === 0 && !classificationCorrectionDraft ? renderCorrectionNotice() : null}

      {classificationCategoryBreakdowns.length > 0 ? (
        <section className="classification-panel-view" aria-label={t("classification.panelAria")} style={classificationPanelStyle}>
          <div className="classification-panel-view__grid">
            <section className="classification-panel-view__panel" aria-label={t("dashboard.today.categories")}>
              <header className="classification-panel-view__panel-header panel-header">
                <div className="panel-header__left">
                  <span className="label-mono">{t("dashboard.today.categories")}</span>
                  <strong className="panel-header__title">{t("classification.trackedCount", { count: classificationCategoryBreakdowns.length })}</strong>
                </div>
                <div className="panel-header__right">
                  <span className="panel-header__meta">{t("common.total")}</span>
                  <strong className="panel-header__value">{formatLocalizedDuration(classificationTotalSeconds, effectiveLanguage)}</strong>
                </div>
              </header>
              <div className="classification-panel-view__panel-body">
                <div className="classification-panel-view__list" role="list">
                  {classificationCategoryBreakdowns.map((breakdown) => {
                    const isSelected = breakdown.category === effectiveClassifyCategoryId;
                    const peakSeconds = classificationCategoryBreakdowns[0]?.totalSeconds ?? 0;
                    const barWidth = Math.max((breakdown.totalSeconds / Math.max(peakSeconds, 1)) * 100, 4);
                    return (
                      <button
                        key={breakdown.category}
                        type="button"
                        className="classification-panel-view__category-row"
                        data-selected={String(isSelected)}
                        aria-pressed={isSelected}
                        onClick={() => onCategorySelect(breakdown.category)}
                      >
                        <div className="classification-panel-view__row-top">
                          <div className="classification-panel-view__row-title">
                            <span className={`category-dot category-dot--${breakdown.category}`} aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0 }} />
                            <strong>{localizedCategoryLabel(breakdown.category, t)}</strong>
                          </div>
                          <span>{formatLocalizedCompactDurationFromSeconds(breakdown.totalSeconds, effectiveLanguage)}</span>
                        </div>
                        <div className="classification-panel-view__bar" aria-hidden="true">
                          <span style={{ width: `${barWidth}%`, background: CATEGORY_COLORS[breakdown.category] }} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="classification-panel-view__panel" aria-label={t("classification.appsSites")}>
              <header className="classification-panel-view__panel-header panel-header">
                <div className="panel-header__left">
                  <span className="label-mono">{t("classification.appsSites")}</span>
                  <strong className="panel-header__title">
                    {selectedClassificationBreakdown ? localizedCategoryLabel(selectedClassificationBreakdown.category, t) : t("classification.noCategory")}
                  </strong>
                </div>
                <div className="panel-header__right">
                  <span className="panel-header__meta">{t("classification.header.source")}</span>
                  <strong className="panel-header__value">{classificationSourceSummaries.length}</strong>
                </div>
              </header>
              <div className="classification-panel-view__panel-body">
                {classificationSourceSummaries.length > 0 ? (
                  <div className="classification-panel-view__list" role="list">
                    {classificationSourceSummaries.map((item) => {
                      const sourceKey = classifySourceKey(item);
                      const isSelected = sourceKey === effectiveClassifySourceId;
                      return (
                        <button
                          key={sourceKey}
                          type="button"
                          className="classification-panel-view__source-row"
                          data-selected={String(isSelected)}
                          aria-pressed={isSelected}
                          onClick={() => onSourceSelect(sourceKey)}
                        >
                          <div className="classification-panel-view__source-icon">
                            {item.usageKind === "site" && item.siteDomain
                              ? <SiteFavicon domain={item.siteDomain} size={24} fallbackIconSrc={appIcons[item.appName] ?? null} />
                              : <AppGlyph appName={item.usageKind === "site" ? item.label : item.appName} iconSrc={appIcons[item.appName] ?? null} size="sm" />}
                          </div>
                          <div className="classification-panel-view__source-copy">
                            {/* Narrow windows cut long names; the full name stays on hover. */}
                            <strong title={item.label}>{item.label}</strong>
                            <div className="classification-panel-view__source-meta">
                              <span title={sourceMetaLabel(item)}>{sourceMetaLabel(item)}</span>
                              <span
                                className="classification-panel-view__source-productivity"
                                aria-label={item.productivityMix.map((entry) => `${localizedProductivityLabel(entry.productivity, t)} ${formatLocalizedCompactDurationFromSeconds(entry.totalSeconds, effectiveLanguage)}`).join(", ")}
                                title={item.productivityMix.map((entry) => `${localizedProductivityLabel(entry.productivity, t)} ${formatLocalizedCompactDurationFromSeconds(entry.totalSeconds, effectiveLanguage)}`).join(", ")}
                              >
                                {item.productivityMix.map((entry) => (
                                  <span
                                    key={entry.productivity}
                                    className={`classification-panel-view__source-productivity-dot classification-panel-view__source-productivity-dot--${entry.productivity}`}
                                    style={{ width: `${Math.max(7, Math.round(entry.ratio * 18))}px` }}
                                    aria-hidden="true"
                                  />
                                ))}
                              </span>
                            </div>
                          </div>
                          <div className="classification-panel-view__source-measure">
                            <strong>{formatLocalizedCompactDurationFromSeconds(item.totalSeconds, effectiveLanguage)}</strong>
                            <span>{item.shareOfTotal * 100 >= 10 ? `${Math.round(item.shareOfTotal * 100)}%` : `${(item.shareOfTotal * 100).toFixed(1)}%`}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="classification-panel-view__empty">
                    <span className="label-mono">{t("classification.appsSites")}</span>
                    <strong>{t("classification.noSourcesTitle")}</strong>
                    <p>{t("classification.noSourcesDetail")}</p>
                    <div className="classification-panel-view__empty-actions">
                      {!isCurrentClassificationRange ? <button type="button" className="app-btn app-btn--secondary" onClick={onTodayClassificationRange}>{t("classification.today")}</button> : null}
                      <button type="button" className="app-btn app-btn--secondary" onClick={() => onRangeChange(alternateRange)}>{t("classification.showRange", { range: t(alternateRange === "Day" ? "common.day" : "common.week") })}</button>
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="classification-panel-view__panel classification-panel-view__panel--detail" aria-label={t("classification.activityDetails")}>
              {selectedClassificationSourceSummary ? (
                <>
                  <div className="classification-panel-view__detail-top" data-recently-corrected={String(recentlyCorrectedRowId === "__surface__")}>
                  <header className="classification-panel-view__panel-header panel-header">
                    <div className="panel-header__left">
                      <span className="label-mono">{t("classification.activityDetails")}</span>
                      <div className="classification-panel-view__detail-title">
                        <span className="classification-panel-view__detail-icon">
                          {selectedClassificationSourceSummary.usageKind === "site" && selectedClassificationSourceSummary.siteDomain
                            ? <SiteFavicon domain={selectedClassificationSourceSummary.siteDomain} size={22} fallbackIconSrc={appIcons[selectedClassificationSourceSummary.appName] ?? null} />
                            : <AppGlyph appName={selectedClassificationSourceSummary.usageKind === "site" ? selectedClassificationSourceSummary.label : selectedClassificationSourceSummary.appName} iconSrc={appIcons[selectedClassificationSourceSummary.appName] ?? null} size="sm" />}
                        </span>
                        <strong className="panel-header__title">
                          {selectedClassificationSourceSummary.label}
                        </strong>
                      </div>
                    </div>
                    <div className="panel-header__right classification-panel-view__detail-header-actions">
                      <div className="classification-panel-view__detail-meta">
                        <span className="panel-header__meta">
                          {selectedClassificationSourceSummary.sessionCount === 1 ? t("classification.sessionCountOne") : t("classification.sessionCount", { count: selectedClassificationSourceSummary.sessionCount })}
                        </span>
                        <strong className="panel-header__value">{formatLocalizedCompactDurationFromSeconds(selectedClassificationSourceSummary.totalSeconds, effectiveLanguage)}</strong>
                      </div>
                      <button
                        type="button"
                        ref={surfaceCorrectionButtonRef}
                        className="app-btn app-btn--quiet app-btn--compact classification-correction__surface-button"
                        aria-label={t("classification.correctSurface", { surface: t(selectedClassificationSourceSummary.usageKind === "site" ? "classification.domain" : "classification.app") })}
                        title={t("classification.correctSurface", { surface: t(selectedClassificationSourceSummary.usageKind === "site" ? "classification.domain" : "classification.app") })}
                        aria-expanded={classificationCorrectionDraft?.scope === "surface"}
                        aria-haspopup="dialog"
                        data-active={String(classificationCorrectionDraft?.scope === "surface")}
                        onClick={onStartClassificationSurfaceCorrection}
                      >
                        <ClassificationEditGlyph />
                        <span className="sr-only">{t("classification.reclassify")}</span>
                      </button>
                    </div>
                  </header>
                  {!classificationCorrectionDraft ? renderCorrectionNotice() : null}
                  </div>
                  <div className="classification-panel-view__panel-body">
                    <div className="classification-panel-view__list" role="list">
                      {classificationActivityRows.map((row) => {
                        const firstSegment = row.segments[0];
                        const lastSegment = row.segments[row.segments.length - 1];
                        const startedLabel = firstSegment ? formatLocalizedTimeLabel(firstSegment.startedAt, effectiveLanguage) : row.startedLabel;
                        const endedLabel = lastSegment ? formatLocalizedTimeLabel(lastSegment.endedAt, effectiveLanguage) : row.endedLabel;
                        const rowMeta = `${row.count === 1 ? t("classification.activityCountOne") : t("classification.activityCount", { count: row.count })} · ${startedLabel} - ${endedLabel}`;
                        // A row we could not name is not an activity, so it is
                        // labelled as unidentified time instead of borrowing the
                        // app or domain name.
                        const rowLabel = row.unidentified ? t("classification.unidentifiedActivity") : row.label;
                        const isRowCorrecting = Boolean(
                          classificationCorrectionDraft
                          && classificationCorrectionDraft.scope !== "surface"
                          && classificationCorrectionDraft.rowId === row.id,
                        );
                        const rowCorrectionLabel = row.unidentified
                          ? t("classification.correctRecords", { count: row.count })
                          : t("classification.correctDetail", { label: rowLabel });
                        const isExpanded = row.hasDetails && expandedClassificationActivityRows.has(row.id);
                        const detailsId = classificationActivityDetailsId(row.id);
                        const rowSummary = (
                          <>
                            <div className="classification-panel-view__activity-copy">
                              <strong title={rowLabel}>{rowLabel}</strong>
                              <span title={rowMeta}>{rowMeta}</span>
                            </div>
                            <div className="classification-panel-view__activity-measure">
                              <div className="classification-panel-view__bar" aria-hidden="true">
                                <span style={{ width: `${Math.max((row.totalSeconds / Math.max(classificationActivityPeakSeconds, 1)) * 100, 4)}%`, background: selectedClassificationTone }} />
                              </div>
                              <strong>{formatLocalizedCompactDurationFromSeconds(row.totalSeconds, effectiveLanguage)}</strong>
                            </div>
                          </>
                        );
                        return (
                          <div key={row.id} className="classification-panel-view__activity-row" role="listitem" data-expandable={String(row.hasDetails)} data-expanded={String(isExpanded)} data-unidentified={String(row.unidentified)} data-correcting={String(isRowCorrecting)} data-recently-corrected={String(recentlyCorrectedRowId === row.id)}>
                            <div className="classification-panel-view__activity-head">
                              {row.hasDetails ? (
                                <button
                                  type="button"
                                  className="classification-panel-view__activity-toggle"
                                  aria-expanded={isExpanded}
                                  aria-controls={detailsId}
                                  onClick={() => onActivityRowToggle(row.id)}
                                >
                                  {rowSummary}
                                  <span className="sr-only">{t("classification.captureDetailsState", { state: t(isExpanded ? "classification.expanded" : "classification.collapsed") })}</span>
                                  <span className="classification-panel-view__activity-chevron" aria-hidden="true"><NavChevronIcon direction="right" /></span>
                                </button>
                              ) : (
                                <div className="classification-panel-view__activity-summary">
                                  {rowSummary}
                                </div>
                              )}
                              <button
                                type="button"
                                ref={registerDetailCorrectionButton(row.id)}
                                className="app-btn app-btn--quiet app-btn--compact classification-correction__detail-button"
                                aria-label={rowCorrectionLabel}
                                title={rowCorrectionLabel}
                                aria-expanded={isRowCorrecting}
                                aria-haspopup="dialog"
                                data-active={String(isRowCorrecting)}
                                onClick={() => onStartClassificationDetailCorrection(row.id)}
                              >
                                <ClassificationEditGlyph />
                                <span className="sr-only">{t("classification.reclassify")}</span>
                              </button>
                            </div>
                            {isExpanded ? (() => {
                              const surfaceDetails = captureRowSurfaceDetails(row.segments).map((detail) => localizeCaptureSurfaceDetail(detail, effectiveLanguage));
                              const summary = classificationRowSummary(row.segments, classificationOptions);
                              return (
                                <div id={detailsId} className="classification-panel-view__activity-details" role="region" aria-label={t("classification.captureDetailsFor", { label: rowLabel })}>
                                  <div className="classification-panel-view__activity-overview">
                                    {surfaceDetails.length > 0 ? (
                                      <div className="classification-panel-view__activity-surface" aria-label={t("classification.captureSurface")}>
                                        <span className="label-mono">{t("classification.surface")}</span>
                                        <div className="classification-panel-view__activity-surface-list">
                                          {surfaceDetails.map((detail) => <span key={detail}>{detail}</span>)}
                                        </div>
                                      </div>
                                    ) : null}
                                    {summary ? (
                                      <dl className="classification-panel-view__activity-classification" aria-label={t("classification.summary")}>
                                        <div><dt>{t("common.category")}</dt><dd>{localizeClassificationSummaryValue(summary.categoryLabel, effectiveLanguage)}</dd></div>
                                        <div><dt>{t("common.productivity")}</dt><dd>{localizeClassificationSummaryValue(summary.productivityLabel, effectiveLanguage)}</dd></div>
                                        {devModeEnabled || summary.sourceLabel === "Manual" || summary.sourceLabel === "Custom rule"
                                          ? <div><dt>{t("common.source")}</dt><dd>{localizeClassificationSummaryValue(summary.sourceLabel, effectiveLanguage)}</dd></div>
                                          : null}
                                        <div><dt>{t("classification.confidence")}</dt><dd>{localizeClassificationSummaryValue(summary.confidenceLabel, effectiveLanguage)}</dd></div>
                                      </dl>
                                    ) : null}
                                  </div>
                                  <div className="classification-panel-view__capture-timeline">
                                    <span className="label-mono">{t("classification.captureSlices")}</span>
                                    <div className="classification-panel-view__capture-slice-list" role="list" aria-label={t("classification.captureSlicesFor", { label: rowLabel })}>
                                      {buildCaptureSliceGroups(row.segments).map((group, index) => {
                                        const groupRange = formatLocalizedCompactTimeRange(group.startedAt, group.endedAt, effectiveLanguage);
                                        const groupDuration = formatLocalizedShortDurationFromSeconds(group.durationSeconds, effectiveLanguage);
                                        const groupTitle = classificationActivityLabel(group.segments[0]);
                                        const sliceCount = group.segments.length;
                                        return (
                                          <div key={group.id} className="classification-panel-view__capture-slice" role="listitem" aria-label={sliceCount > 1 ? t("classification.captureSliceGroupAria", { index: index + 1, title: groupTitle, range: groupRange, duration: groupDuration, count: sliceCount }) : t("classification.captureSliceAria", { index: index + 1, title: groupTitle, range: groupRange, duration: groupDuration })}>
                                            <span className="classification-panel-view__capture-slice-time">
                                              {groupRange}
                                              {sliceCount > 1 ? <span className="classification-panel-view__capture-slice-count"> · {t("classification.captureSliceCount", { count: sliceCount })}</span> : null}
                                            </span>
                                            <strong className="classification-panel-view__capture-slice-duration">{groupDuration}</strong>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                              );
                            })() : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <div className="classification-panel-view__empty">
                  <span className="label-mono">{t("classification.activityDetails")}</span>
                  <strong>{t("classification.selectSourceTitle")}</strong>
                  <p>{t("classification.selectSourceDetail")}</p>
                  {firstSourceKey ? (
                    <div className="classification-panel-view__empty-actions">
                      <button type="button" className="app-btn app-btn--secondary" onClick={() => onSourceSelect(firstSourceKey)}>{t("classification.openFirstSource")}</button>
                    </div>
                  ) : null}
                </div>
              )}
            </section>
          </div>
        </section>
      ) : (
        <section className="classification-panel-view classification-panel-view--empty-state" aria-label={t("classification.panelAria")}>
          <div className="classification-panel-view__empty classification-panel-view__empty--full">
            <span className="label-mono">{t("classification.emptyLabel")}</span>
            <strong>{t("classification.noDataTitle")}</strong>
            <p>{t("classification.noDataDetail")}</p>
            <div className="classification-panel-view__empty-actions">
              {!isCurrentClassificationRange ? <button type="button" className="app-btn app-btn--secondary" onClick={onTodayClassificationRange}>{t("classification.today")}</button> : null}
              <button type="button" className="app-btn app-btn--secondary" onClick={() => onRangeChange(alternateRange)}>{t("classification.showRange", { range: t(alternateRange === "Day" ? "common.day" : "common.week") })}</button>
            </div>
          </div>
        </section>
      )}
      {renderClassificationCorrectionPopover()}
    </div>
  );
}
