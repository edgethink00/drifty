import {
  CATEGORY_ORDER,
  PRODUCTIVITY_ORDER,
  type ActivityCategory,
  type AppIconMap,
  type ClassificationOptions,
  type ProductivityLabel,
} from "@drifty/domain";
import type { ClassificationCorrectionDraft, ClassificationCorrectionNotice } from "./classificationCorrection";
import { useEffect, type CSSProperties } from "react";
import { AppGlyph } from "../../components/AppGlyph";
import { DateNavigator } from "../../components/DateNavigator";
import { SiteFavicon } from "../../components/SiteFavicon";
import { CATEGORY_COLORS, PRODUCTIVITY_COLORS } from "../../lib/activityLabels";
import { formatLocalizedCompactDurationFromSeconds, formatLocalizedDuration, formatLocalizedTimeLabel } from "../../lib/formatting";
import type { ClassificationRange } from "../dashboard/dashboardPeriods";
import {
  CLASSIFICATION_FOCUS_RATE_DESCRIPTION,
  CLASSIFICATION_FOCUS_RATE_LABEL,
} from "./classificationFocusRate";
import type { ClassificationPanelStyle } from "./ClassificationBreakdownCards";
import {
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

function moveClassificationRadioValue<T>(values: readonly T[], current: T, key: string): T | null {
  if (!values.length) return null;
  const index = Math.max(0, values.indexOf(current));
  if (key === "ArrowRight" || key === "ArrowDown") return values[(index + 1) % values.length] ?? current;
  if (key === "ArrowLeft" || key === "ArrowUp") return values[(index - 1 + values.length) % values.length] ?? current;
  if (key === "Home") return values[0] ?? current;
  if (key === "End") return values[values.length - 1] ?? current;
  return null;
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
  useEffect(() => {
    if (!classificationCorrectionDraft) return;
    const activeGroup = document.activeElement instanceof HTMLElement
      ? document.activeElement.closest('[role="radiogroup"]')
      : null;
    if (!activeGroup || !activeGroup.closest('.classification-correction')) return;
    const next = activeGroup.querySelector<HTMLButtonElement>('.classification-correction__chip[data-selected="true"]');
    if (next && document.activeElement !== next) next.focus();
  }, [classificationCorrectionDraft]);

  const renderClassificationCorrection = (placement: "surface" | "detail") => {

    if (!classificationCorrectionDraft) return null;

    const correctionSummaryLabel = classificationCorrectionDraft.displayLabel ?? classificationCorrectionDraft.targetValue;
    const categoryValues = CATEGORY_ORDER.filter((category) => category !== "unknown");

    const isDetailCorrection = classificationCorrectionDraft.scope === "detail";
    const targetLabel = classificationCorrectionDraft.displayLabel ?? classificationCorrectionDraft.targetValue;
    const scopeDescription = isDetailCorrection
      ? t("classification.correction.detailScope", { detail: localizedCorrectionDetailLabel(classificationCorrectionDraft.detailKind, t) })
      : t("classification.correction.surfaceScope", { target: targetLabel });

    return (
      <div className={`classification-correction classification-correction--${placement}`} role="group" aria-label={t(classificationCorrectionDraft.scope === "detail" ? "classification.correction.detailAria" : "classification.correction.surfaceAria")} style={{ "--correction-tone": CATEGORY_COLORS[classificationCorrectionDraft.category] } as CSSProperties}>
        <div className="classification-correction__identity">
          <p>{scopeDescription}</p>
          {isDetailCorrection && classificationCorrectionDraft.detailValue && classificationCorrectionDraft.detailValue !== correctionSummaryLabel ? (
            <span className="classification-correction__match">{classificationCorrectionDraft.detailValue}</span>
          ) : null}
        </div>
        <div
          className="classification-correction__palette"
          role="radiogroup"
          aria-label={t("common.category")}
          onKeyDown={(event) => {
            const next = moveClassificationRadioValue(categoryValues, classificationCorrectionDraft.category, event.key);
            if (!next || next === classificationCorrectionDraft.category) return;
            event.preventDefault();
            onClassificationCorrectionCategoryChange(next);
          }}
        >
          {categoryValues.map((category) => {
            const selected = category === classificationCorrectionDraft.category;
            return (
              <button
                key={category}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                disabled={classificationCorrectionSaving}
                className="classification-correction__chip"
                data-selected={String(selected)}
                style={{ "--chip-tone": CATEGORY_COLORS[category] } as CSSProperties}
                onClick={() => onClassificationCorrectionCategoryChange(category)}
              >
                {localizedCategoryLabel(category, t)}
              </button>
            );
          })}
        </div>
        <div
          className="classification-correction__productivity"
          role="radiogroup"
          aria-label={t("common.productivity")}
          onKeyDown={(event) => {
            const next = moveClassificationRadioValue(PRODUCTIVITY_ORDER, classificationCorrectionDraft.productivity, event.key);
            if (!next || next === classificationCorrectionDraft.productivity) return;
            event.preventDefault();
            onClassificationCorrectionProductivityChange(next);
          }}
        >
          {PRODUCTIVITY_ORDER.map((productivity) => {
            const selected = productivity === classificationCorrectionDraft.productivity;
            return (
              <button
                key={productivity}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                disabled={classificationCorrectionSaving}
                className="classification-correction__chip"
                data-selected={String(selected)}
                style={{ "--chip-tone": PRODUCTIVITY_COLORS[productivity] } as CSSProperties}
                onClick={() => onClassificationCorrectionProductivityChange(productivity)}
              >
                {localizedProductivityLabel(productivity, t)}
              </button>
            );
          })}
        </div>
        {classificationCorrectionNotice?.kind === "error" ? (
          <div className="classification-correction__notice classification-correction__notice--error" role="alert">
            <span>{classificationCorrectionNotice.message}</span>
          </div>
        ) : null}
        <div className="classification-correction__actions">
          <button type="button" className="app-btn app-btn--quiet app-btn--compact classification-correction__ghost-button" onClick={onCancelClassificationCorrection} disabled={classificationCorrectionSaving}>{t("common.cancel")}</button>
          <button type="button" className="app-btn app-btn--secondary app-btn--compact classification-correction__save-button" onClick={onSaveClassificationCorrection} disabled={classificationCorrectionSaving}>
            {classificationCorrectionSaving ? <span className="classification-correction__spinner" aria-hidden="true" /> : null}
            {classificationCorrectionSaving ? t("classification.correction.applying") : t("classification.correction.apply")}
          </button>
        </div>
      </div>
    );
  };

  const renderCorrectionNotice = () => classificationCorrectionNotice?.kind === "success" ? (
    <div className="classification-correction-result" role="status">
      {classificationCorrectionNotice.message}
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
            todayLabel={t("classification.today")}
            todayActionLabel={effectiveLanguage === "ko" ? t("classification.goToday") : undefined}
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
            <strong>{classificationTopAppLabel}</strong>
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
                            <strong>{item.label}</strong>
                            <div className="classification-panel-view__source-meta">
                              <span>{item.sessionCount === 1 ? t("classification.sessionCountOne") : t("classification.sessionCount", { count: item.sessionCount })} · {t("classification.averageValue", { duration: formatLocalizedCompactDurationFromSeconds(item.averageSessionSeconds, effectiveLanguage) })}</span>
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
                  <div className="classification-panel-view__detail-top">
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
                        className="app-btn app-btn--quiet app-btn--compact classification-correction__surface-button"
                        aria-label={t("classification.correctSurface", { surface: t(selectedClassificationSourceSummary.usageKind === "site" ? "classification.domain" : "classification.app") })}
                        title={t("classification.correctSurface", { surface: t(selectedClassificationSourceSummary.usageKind === "site" ? "classification.domain" : "classification.app") })}
                        aria-expanded={classificationCorrectionDraft?.scope === "surface"}
                        data-active={String(classificationCorrectionDraft?.scope === "surface")}
                        onClick={onStartClassificationSurfaceCorrection}
                      >
                        <ClassificationEditGlyph />
                        <span className="sr-only">{t("classification.reclassify")}</span>
                      </button>
                    </div>
                  </header>
                  {classificationCorrectionDraft?.scope === "surface" ? renderClassificationCorrection("surface") : null}
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
                        const isExpanded = row.hasDetails && expandedClassificationActivityRows.has(row.id);
                        const detailsId = classificationActivityDetailsId(row.id);
                        const rowSummary = (
                          <>
                            <div className="classification-panel-view__activity-copy">
                              <strong title={row.label}>{row.label}</strong>
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
                          <div key={row.id} className="classification-panel-view__activity-row" role="listitem" data-expandable={String(row.hasDetails)} data-expanded={String(isExpanded)}>
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
                                  <span className="classification-panel-view__activity-chevron" aria-hidden="true">{isExpanded ? "⌄" : ">"}</span>
                                </button>
                              ) : (
                                <div className="classification-panel-view__activity-summary">
                                  {rowSummary}
                                </div>
                              )}
                              <button
                                type="button"
                                className="app-btn app-btn--quiet app-btn--compact classification-correction__detail-button"
                                aria-label={t("classification.correctDetail", { label: row.label })}
                                title={t("classification.correctDetail", { label: row.label })}
                                aria-expanded={classificationCorrectionDraft?.scope === "detail" && classificationCorrectionDraft.rowId === row.id}
                                data-active={String(classificationCorrectionDraft?.scope === "detail" && classificationCorrectionDraft.rowId === row.id)}
                                onClick={() => onStartClassificationDetailCorrection(row.id)}
                              >
                                <ClassificationEditGlyph />
                                <span className="sr-only">{t("classification.reclassify")}</span>
                              </button>
                            </div>
                            {classificationCorrectionDraft?.scope === "detail" && classificationCorrectionDraft.rowId === row.id ? renderClassificationCorrection("detail") : null}
                            {isExpanded ? (() => {
                              const surfaceDetails = captureRowSurfaceDetails(row.segments).map((detail) => localizeCaptureSurfaceDetail(detail, effectiveLanguage));
                              const summary = classificationRowSummary(row.segments, classificationOptions);
                              return (
                                <div id={detailsId} className="classification-panel-view__activity-details" role="region" aria-label={t("classification.captureDetailsFor", { label: row.label })}>
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
                                    <div className="classification-panel-view__capture-slice-list" role="list" aria-label={t("classification.captureSlicesFor", { label: row.label })}>
                                      {row.segments.map((segment, index) => {
                                        const segmentRange = `${formatLocalizedTimeLabel(segment.startedAt, effectiveLanguage)} - ${formatLocalizedTimeLabel(segment.endedAt, effectiveLanguage)}`;
                                        const segmentDuration = formatLocalizedCompactDurationFromSeconds(segment.durationSeconds, effectiveLanguage);
                                        const segmentTitle = classificationActivityLabel(segment);
                                        return (
                                          <div key={segment.id} className="classification-panel-view__capture-slice" role="listitem" aria-label={t("classification.captureSliceAria", { index: index + 1, title: segmentTitle, range: segmentRange, duration: segmentDuration })}>
                                            <div className="classification-panel-view__capture-slice-copy">
                                              <strong className="classification-panel-view__capture-slice-title" title={segmentTitle}>{segmentTitle}</strong>
                                              <span className="classification-panel-view__capture-slice-time">{segmentRange}</span>
                                            </div>
                                            <strong className="classification-panel-view__capture-slice-duration">{segmentDuration}</strong>
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
    </div>
  );
}
