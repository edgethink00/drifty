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
import { CATEGORY_COLORS, PRODUCTIVITY_COLORS, categoryLabel, productivityLabel } from "../../lib/activityLabels";
import { formatCompactDurationFromSeconds, formatDuration, formatTimeLabel } from "../../lib/formatting";
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
  classificationRuleDetailKindLabel,
  classificationRuleTargetLabel,
  classifySourceKey,
  formatClassificationSourceProductivityMix,
  type ClassificationActivityRow,
  type ClassificationCategoryBreakdown,
  type ClassificationSourceSummary,
} from "./classificationViewData";

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
    const targetLabel = classificationRuleTargetLabel(classificationCorrectionDraft.targetKind).toLowerCase();
    const scopeDescription = isDetailCorrection
      ? `Applies to this ${classificationRuleDetailKindLabel(classificationCorrectionDraft.detailKind).toLowerCase()} from now on.`
      : `Applies to all future ${targetLabel} activity. Existing manual corrections stay.`;

    return (
      <div className={`classification-correction classification-correction--${placement}`} role="group" aria-label={classificationCorrectionDraft.scope === "detail" ? "Detail classification correction" : "App or domain classification correction"} style={{ "--correction-tone": CATEGORY_COLORS[classificationCorrectionDraft.category] } as CSSProperties}>
        <div className="classification-correction__identity">
          <p>{scopeDescription}</p>
          {isDetailCorrection && classificationCorrectionDraft.detailValue && classificationCorrectionDraft.detailValue !== correctionSummaryLabel ? (
            <span className="classification-correction__match">{classificationCorrectionDraft.detailValue}</span>
          ) : null}
        </div>
        <div
          className="classification-correction__palette"
          role="radiogroup"
          aria-label="Category"
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
                className="classification-correction__chip"
                data-selected={String(selected)}
                style={{ "--chip-tone": CATEGORY_COLORS[category] } as CSSProperties}
                onClick={() => onClassificationCorrectionCategoryChange(category)}
              >
                {categoryLabel(category)}
              </button>
            );
          })}
        </div>
        <div
          className="classification-correction__productivity"
          role="radiogroup"
          aria-label="Productivity"
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
                className="classification-correction__chip"
                data-selected={String(selected)}
                style={{ "--chip-tone": PRODUCTIVITY_COLORS[productivity] } as CSSProperties}
                onClick={() => onClassificationCorrectionProductivityChange(productivity)}
              >
                {productivityLabel(productivity)}
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
          <button type="button" className="app-btn app-btn--quiet app-btn--compact classification-correction__ghost-button" onClick={onCancelClassificationCorrection} disabled={classificationCorrectionSaving}>Cancel</button>
          <button type="button" className="app-btn app-btn--secondary app-btn--compact classification-correction__save-button" onClick={onSaveClassificationCorrection} disabled={classificationCorrectionSaving}>
            {classificationCorrectionSaving ? <span className="classification-correction__spinner" aria-hidden="true" /> : null}
            {classificationCorrectionSaving ? "Applying" : "Apply"}
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
          <h1>Activity breakdown</h1>
        </div>
        <div className="classification-range-controls">
          <div className="settings-mode-switch" role="radiogroup" aria-label="Classification range">
            {(["Day", "Week"] as const).map((range) => (
              <button
                key={range}
                type="button"
                className={`settings-mode-option${classificationRange === range ? " is-active" : ""}`}
                role="radio"
                aria-checked={classificationRange === range}
                onClick={() => onRangeChange(range)}
              >
                <span>{range}</span>
              </button>
            ))}
          </div>
          <DateNavigator
            ariaLabel={`Classification ${classificationRange.toLowerCase()} selector`}
            label={classificationDateLabel}
            todayLabel="Today"
            isTodayDisabled={isCurrentClassificationRange}
            isNextDisabled={!canShiftClassificationForward}
            onPrevious={onPreviousClassificationRange}
            onNext={onNextClassificationRange}
            onToday={onTodayClassificationRange}
            previousLabel={classificationRange === "Week" ? "Show previous classification week" : "Show previous day"}
            nextLabel={classificationRange === "Week" ? "Show next classification week" : "Show next day"}
          />
        </div>
      </div>

      <div className="clf-summary">
        <div className="clf-stat"><span className="eyebrow">Total</span><strong>{formatDuration(classificationTotalSeconds)}</strong></div>
        <div className="clf-stat"><span className="eyebrow">Sessions</span><strong>{classificationSessionCount}</strong></div>
        <div className="clf-stat clf-stat--with-icon">
          <span className="eyebrow">Top app</span>
          <div className="clf-stat__row">
            <AppGlyph appName={classificationTopAppName} iconSrc={classificationTopAppIconSrc} size="sm" />
            <strong>{classificationTopAppLabel}</strong>
          </div>
        </div>
        <div
          className="clf-stat"
          role="group"
          aria-label={`${CLASSIFICATION_FOCUS_RATE_LABEL}, ${CLASSIFICATION_FOCUS_RATE_DESCRIPTION}`}
          title={CLASSIFICATION_FOCUS_RATE_DESCRIPTION}
        >
          <span className="eyebrow">{CLASSIFICATION_FOCUS_RATE_LABEL}</span>
          <strong>{classificationFocusRatePercent}%</strong>
        </div>
      </div>

      {classificationCategoryBreakdowns.length === 0 && !classificationCorrectionDraft ? renderCorrectionNotice() : null}

      {classificationCategoryBreakdowns.length > 0 ? (
        <section className="classification-panel-view" aria-label="Classification panel view" style={classificationPanelStyle}>
          <div className="classification-panel-view__grid">
            <section className="classification-panel-view__panel" aria-label="Categories">
              <header className="classification-panel-view__panel-header panel-header">
                <div className="panel-header__left">
                  <span className="label-mono">Categories</span>
                  <strong className="panel-header__title">{classificationCategoryBreakdowns.length} tracked</strong>
                </div>
                <div className="panel-header__right">
                  <span className="panel-header__meta">Total</span>
                  <strong className="panel-header__value">{formatDuration(classificationTotalSeconds)}</strong>
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
                            <strong>{categoryLabel(breakdown.category)}</strong>
                          </div>
                          <span>{formatCompactDurationFromSeconds(breakdown.totalSeconds)}</span>
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

            <section className="classification-panel-view__panel" aria-label="Apps and sites">
              <header className="classification-panel-view__panel-header panel-header">
                <div className="panel-header__left">
                  <span className="label-mono">Apps &amp; Sites</span>
                  <strong className="panel-header__title">
                    {selectedClassificationBreakdown ? categoryLabel(selectedClassificationBreakdown.category) : "No category"}
                  </strong>
                </div>
                <div className="panel-header__right">
                  <span className="panel-header__meta">{classificationSourceSummaries.length === 1 ? "source" : "sources"}</span>
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
                              <span>{item.sessionCount} {item.sessionCount === 1 ? "session" : "sessions"} · {formatCompactDurationFromSeconds(item.averageSessionSeconds)} avg</span>
                              <span className="classification-panel-view__source-productivity" aria-label={formatClassificationSourceProductivityMix(item.productivityMix)} title={formatClassificationSourceProductivityMix(item.productivityMix)}>
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
                            <strong>{formatCompactDurationFromSeconds(item.totalSeconds)}</strong>
                            <span>{item.shareOfTotal * 100 >= 10 ? `${Math.round(item.shareOfTotal * 100)}%` : `${(item.shareOfTotal * 100).toFixed(1)}%`}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="classification-panel-view__empty">
                    <span className="label-mono">Apps &amp; Sites</span>
                    <strong>No sources in this category yet</strong>
                    <p>Tracked apps and browser surfaces will appear here once this category has activity in the selected range.</p>
                    <div className="classification-panel-view__empty-actions">
                      {!isCurrentClassificationRange ? <button type="button" className="app-btn app-btn--secondary" onClick={onTodayClassificationRange}>Today</button> : null}
                      <button type="button" className="app-btn app-btn--secondary" onClick={() => onRangeChange(alternateRange)}>Show {alternateRange.toLowerCase()}</button>
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="classification-panel-view__panel classification-panel-view__panel--detail" aria-label="Activity details">
              {selectedClassificationSourceSummary ? (
                <>
                  <div className="classification-panel-view__detail-top">
                  <header className="classification-panel-view__panel-header panel-header">
                    <div className="panel-header__left">
                      <span className="label-mono">Activity details</span>
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
                          {selectedClassificationSourceSummary.sessionCount} {selectedClassificationSourceSummary.sessionCount === 1 ? "session" : "sessions"}
                        </span>
                        <strong className="panel-header__value">{formatCompactDurationFromSeconds(selectedClassificationSourceSummary.totalSeconds)}</strong>
                      </div>
                      <button
                        type="button"
                        className="app-btn app-btn--quiet app-btn--compact classification-correction__surface-button"
                        aria-label={`Correct ${selectedClassificationSourceSummary.usageKind === "site" ? "domain" : "app"} classification`}
                        title={`Correct ${selectedClassificationSourceSummary.usageKind === "site" ? "domain" : "app"} classification`}
                        aria-expanded={classificationCorrectionDraft?.scope === "surface"}
                        data-active={String(classificationCorrectionDraft?.scope === "surface")}
                        onClick={onStartClassificationSurfaceCorrection}
                      >
                        <ClassificationEditGlyph />
                        <span className="sr-only">Reclassify</span>
                      </button>
                    </div>
                  </header>
                  {classificationCorrectionDraft?.scope === "surface" ? renderClassificationCorrection("surface") : null}
                  {!classificationCorrectionDraft ? renderCorrectionNotice() : null}
                  </div>
                  <div className="classification-panel-view__panel-body">
                    <div className="classification-panel-view__list" role="list">
                      {classificationActivityRows.map((row) => {
                        const rowMeta = `${row.count} ${row.count === 1 ? "activity" : "activities"} · ${row.startedLabel} - ${row.endedLabel}`;
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
                              <strong>{formatCompactDurationFromSeconds(row.totalSeconds)}</strong>
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
                                  <span className="sr-only">Capture details {isExpanded ? "expanded" : "collapsed"}</span>
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
                                aria-label={`Correct this detail: ${row.label}`}
                                title={`Correct this detail: ${row.label}`}
                                aria-expanded={classificationCorrectionDraft?.scope === "detail" && classificationCorrectionDraft.rowId === row.id}
                                data-active={String(classificationCorrectionDraft?.scope === "detail" && classificationCorrectionDraft.rowId === row.id)}
                                onClick={() => onStartClassificationDetailCorrection(row.id)}
                              >
                                <ClassificationEditGlyph />
                                <span className="sr-only">Reclassify</span>
                              </button>
                            </div>
                            {classificationCorrectionDraft?.scope === "detail" && classificationCorrectionDraft.rowId === row.id ? renderClassificationCorrection("detail") : null}
                            {isExpanded ? (() => {
                              const surfaceDetails = captureRowSurfaceDetails(row.segments);
                              const summary = classificationRowSummary(row.segments, classificationOptions);
                              return (
                                <div id={detailsId} className="classification-panel-view__activity-details" role="region" aria-label={`Capture details for ${row.label}`}>
                                  <div className="classification-panel-view__activity-overview">
                                    {surfaceDetails.length > 0 ? (
                                      <div className="classification-panel-view__activity-surface" aria-label="Capture surface">
                                        <span className="label-mono">Surface</span>
                                        <div className="classification-panel-view__activity-surface-list">
                                          {surfaceDetails.map((detail) => <span key={detail}>{detail}</span>)}
                                        </div>
                                      </div>
                                    ) : null}
                                    {summary ? (
                                      <dl className="classification-panel-view__activity-classification" aria-label="Classification summary">
                                        <div><dt>Category</dt><dd>{summary.categoryLabel}</dd></div>
                                        <div><dt>Productivity</dt><dd>{summary.productivityLabel}</dd></div>
                                        <div><dt>Source</dt><dd>{summary.sourceLabel}</dd></div>
                                        <div><dt>Confidence</dt><dd>{summary.confidenceLabel}</dd></div>
                                      </dl>
                                    ) : null}
                                  </div>
                                  <div className="classification-panel-view__capture-timeline">
                                    <span className="label-mono">Capture slices</span>
                                    <div className="classification-panel-view__capture-slice-list" role="list" aria-label={`Capture slices for ${row.label}`}>
                                      {row.segments.map((segment, index) => {
                                        const segmentRange = `${formatTimeLabel(segment.startedAt)} - ${formatTimeLabel(segment.endedAt)}`;
                                        const segmentDuration = formatCompactDurationFromSeconds(segment.durationSeconds);
                                        const segmentTitle = classificationActivityLabel(segment);
                                        return (
                                          <div key={segment.id} className="classification-panel-view__capture-slice" role="listitem" aria-label={`Capture slice ${index + 1}: ${segmentTitle}, ${segmentRange}, ${segmentDuration}`}>
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
                  <span className="label-mono">Activity details</span>
                  <strong>Select an app or site to see activity details.</strong>
                  <p>Choose a source from the middle panel to inspect its titles, pages, and time distribution.</p>
                  {firstSourceKey ? (
                    <div className="classification-panel-view__empty-actions">
                      <button type="button" className="app-btn app-btn--secondary" onClick={() => onSourceSelect(firstSourceKey)}>Open first source</button>
                    </div>
                  ) : null}
                </div>
              )}
            </section>
          </div>
        </section>
      ) : (
        <section className="classification-panel-view classification-panel-view--empty-state" aria-label="Classification panel view">
          <div className="classification-panel-view__empty classification-panel-view__empty--full">
            <span className="label-mono">Classification</span>
            <strong>No category data yet</strong>
            <p>Category, source, and activity details will appear here once tracking captures activity for this range.</p>
            <div className="classification-panel-view__empty-actions">
              {!isCurrentClassificationRange ? <button type="button" className="app-btn app-btn--secondary" onClick={onTodayClassificationRange}>Today</button> : null}
              <button type="button" className="app-btn app-btn--secondary" onClick={() => onRangeChange(alternateRange)}>Show {alternateRange.toLowerCase()}</button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
