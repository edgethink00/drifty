import type { FocusEvent, RefObject } from "react";
import {
  CATEGORY_ORDER,
  PRODUCTIVITY_ORDER,
  canonicalizeClassificationRuleSiteUrl,
  secondsToLabel,
  type ActivityCategory,
  type ActivitySegment,
  type AppIconMap,
  type ClassificationRule,
  type ClassificationRuleApplyResult,
  type ClassificationRuleCandidate,
  type ClassificationRuleTargetKind,
  type ProductivityLabel,
} from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import {
  classificationRuleCandidateAppIconSrc,
  normalizeDomainRuleInput,
} from "../classification/classificationViewData";
import { localizedCategoryLabel, localizedProductivityLabel } from "../localization/activityTranslations";
import {
  categoryControlColor,
  productivityControlColor,
  type AppThemeColorOverrides,
  type CategoryColorOverrides,
} from "./settingsStorage";
import { ClassificationSavedRulesList } from "./ClassificationSavedRulesList";
import { ClassificationPicker } from "./SettingsColorControls";
import { useLocalization } from "../localization/LocalizationContext";
import { localizeSettingsError } from "../localization/settingsMessageTranslations";

type DomainRuleMode = "domain" | "url";

type ClassificationSettingsSectionProps = {
  readonly appIcons: AppIconMap;
  readonly appRuleCategory: ActivityCategory;
  readonly appRuleDisplayName: string;
  readonly appRuleProductivity: ProductivityLabel;
  readonly appRuleSearch: string;
  readonly appRuleSearchPanelOpen: boolean;
  readonly appRuleSearchRef: RefObject<HTMLDivElement>;
  readonly appRuleTargetValue: string;
  readonly appThemeColorOverrides: AppThemeColorOverrides;
  readonly categoryColorOverrides: CategoryColorOverrides;
  readonly classificationRuleApplyResult: ClassificationRuleApplyResult | null;
  readonly classificationRuleApplying: boolean;
  readonly classificationRuleCandidates: ClassificationRuleCandidate[];
  readonly classificationRuleCandidatesLoading: boolean;
  readonly classificationRuleDeletingId: string | null;
  readonly classificationRuleMessage: string | null;
  readonly classificationRuleSavingKind: ClassificationRuleTargetKind | null;
  readonly classificationRuleSegments: readonly ActivitySegment[];
  readonly classificationRules: ClassificationRule[];
  readonly classificationRulesError: string | null;
  readonly classificationRulesLoading: boolean;
  readonly domainRuleCandidates: ClassificationRuleCandidate[];
  readonly domainRuleCandidatesLoading: boolean;
  readonly domainRuleCategory: ActivityCategory;
  readonly domainRuleInput: string;
  readonly domainRuleMode: DomainRuleMode;
  readonly domainRuleProductivity: ProductivityLabel;
  readonly domainRuleSearchPanelOpen: boolean;
  readonly domainRuleSearchRef: RefObject<HTMLDivElement>;
  readonly onAppRuleCategoryChange: (category: ActivityCategory) => void;
  readonly onAppRuleProductivityChange: (productivity: ProductivityLabel) => void;
  readonly onAppRuleSearchBlur: (event: FocusEvent<HTMLDivElement>) => void;
  readonly onAppRuleSearchChange: (value: string) => void;
  readonly onAppRuleSearchFocus: () => void;
  readonly onApplyClassificationRules: () => void;
  readonly onDeleteClassificationRule: (rule: ClassificationRule) => void;
  readonly onDomainRuleCategoryChange: (category: ActivityCategory) => void;
  readonly onDomainRuleInputChange: (value: string) => void;
  readonly onDomainRuleModeChange: (mode: DomainRuleMode) => void;
  readonly onDomainRuleProductivityChange: (productivity: ProductivityLabel) => void;
  readonly onDomainRuleSearchBlur: (event: FocusEvent<HTMLDivElement>) => void;
  readonly onDomainRuleSearchFocus: () => void;
  readonly onLoadClassificationRules: () => void;
  readonly onSaveAppRule: () => void;
  readonly onSaveDomainRule: () => void;
  readonly onSelectClassificationCandidate: (candidate: ClassificationRuleCandidate) => void;
  readonly onSelectDomainRuleCandidate: (candidate: ClassificationRuleCandidate) => void;
  readonly onToggleClassificationRule: (rule: ClassificationRule, enabled: boolean) => void;
};

export function ClassificationSettingsSection({
  appIcons,
  appRuleCategory,
  appRuleDisplayName,
  appRuleProductivity,
  appRuleSearch,
  appRuleSearchPanelOpen,
  appRuleSearchRef,
  appRuleTargetValue,
  appThemeColorOverrides,
  categoryColorOverrides,
  classificationRuleApplyResult,
  classificationRuleApplying,
  classificationRuleCandidates,
  classificationRuleCandidatesLoading,
  classificationRuleDeletingId,
  classificationRuleMessage,
  classificationRuleSavingKind,
  classificationRuleSegments,
  classificationRules,
  classificationRulesError,
  classificationRulesLoading,
  domainRuleCandidates,
  domainRuleCandidatesLoading,
  domainRuleCategory,
  domainRuleInput,
  domainRuleMode,
  domainRuleProductivity,
  domainRuleSearchPanelOpen,
  domainRuleSearchRef,
  onAppRuleCategoryChange,
  onAppRuleProductivityChange,
  onAppRuleSearchBlur,
  onAppRuleSearchChange,
  onAppRuleSearchFocus,
  onApplyClassificationRules,
  onDeleteClassificationRule,
  onDomainRuleCategoryChange,
  onDomainRuleInputChange,
  onDomainRuleModeChange,
  onDomainRuleProductivityChange,
  onDomainRuleSearchBlur,
  onDomainRuleSearchFocus,
  onLoadClassificationRules,
  onSaveAppRule,
  onSaveDomainRule,
  onSelectClassificationCandidate,
  onSelectDomainRuleCandidate,
  onToggleClassificationRule,
}: ClassificationSettingsSectionProps) {
  const { effectiveLanguage, t } = useLocalization();
  const exactUrlValue = canonicalizeClassificationRuleSiteUrl(domainRuleInput);
  const exactUrlAvailable = Boolean(exactUrlValue);
  const effectiveDomainRuleMode = domainRuleMode === "url" && exactUrlAvailable ? "url" : "domain";
  const domainRuleSaveLabel = effectiveDomainRuleMode === "url" ? t("settings.classification.saveUrl") : t("settings.classification.saveDomain");

  return (
    <div className="settings-section settings-section--classification">
      <div className="settings-block cloud-overview">
        <h3>{t("settings.section.classification")}</h3>
        <div className="settings-row">
          <div>
            <div className="lbl">{t("settings.classification.rules")}</div>
            <div className="desc">{t("settings.classification.rulesDescription")}</div>
          </div>
          <div className="ctrl"><span className="chip green">{t("settings.classification.localOnly")}</span></div>
        </div>
        <div className="settings-row settings-row--fallback classification-rule-form">
          <div>
            <div className="lbl">{t("settings.classification.addDomain")}</div>
            <div className="desc">{t("settings.classification.addDomainDescription")}</div>
          </div>
          <div className="ctrl classification-rule-form__grid">
            <div ref={domainRuleSearchRef} className="classification-rule-field classification-rule-field--wide classification-rule-search" onFocus={onDomainRuleSearchFocus} onBlur={onDomainRuleSearchBlur}>
              <label htmlFor="classification-domain-rule-search">{t("settings.classification.domainOrUrl")}</label>
              <input id="classification-domain-rule-search" className="settings-input" type="search" value={domainRuleInput} onChange={(event) => onDomainRuleInputChange(event.target.value)} placeholder="example.com" aria-label={t("settings.classification.domainRuleAria")} autoComplete="off" aria-expanded={domainRuleSearchPanelOpen} aria-controls="classification-domain-rule-candidates" />
              {domainRuleSearchPanelOpen ? (
                <div id="classification-domain-rule-candidates" className="classification-rule-candidates classification-rule-search__popover" aria-label={t("settings.classification.recordedSites")}>
                  {domainRuleCandidatesLoading ? <span className="classification-rule-hint">{domainRuleInput.trim() ? t("settings.classification.searchingSites") : t("settings.classification.loadingSites")}</span> : null}
                  {!domainRuleCandidatesLoading && domainRuleCandidates.length === 0 ? <span className="classification-rule-hint">{domainRuleInput.trim() ? t("settings.classification.noSiteMatch") : t("settings.classification.noSites")}</span> : null}
                  {domainRuleCandidates.map((candidate) => {
                    const candidateUsageLabel = localizedCandidateUsageLabel(candidate, t);
                    const siteDomain = candidate.siteDomain ?? candidate.targetValue;
                    const siteDetail = candidate.siteTitle || candidate.browserName || t("settings.classification.recordedSite");
                    return (
                      <button key={candidate.id} type="button" className={`classification-rule-candidate${normalizeDomainRuleInput(domainRuleInput) === candidate.targetValue ? " is-selected" : ""}`} onMouseDown={(event) => event.preventDefault()} onClick={() => onSelectDomainRuleCandidate(candidate)} aria-label={t("settings.classification.chooseCandidateAria", { name: candidate.displayName, usage: candidateUsageLabel })}>
                        <span className="classification-rule-candidate__identity">
                          <SiteFavicon domain={siteDomain} size={20} />
                          <span className="classification-rule-candidate__text"><strong>{candidate.displayName}</strong><small>{siteDetail}</small></span>
                        </span>
                          <span className="classification-rule-candidate__usage"><strong>{secondsToLabel(candidate.totalSeconds)}</strong><em>{localizedSegmentCount(candidate.segmentCount, t)}</em></span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <div className="classification-rule-field classification-rule-mode-field">
              <span>{t("settings.classification.ruleType")}</span>
              <div className="settings-mode-switch settings-mode-switch--compact classification-rule-mode-control" role="radiogroup" aria-label={t("settings.classification.ruleType")}>
                <button type="button" className={`settings-mode-option${effectiveDomainRuleMode === "domain" ? " is-active" : ""}`} role="radio" aria-checked={effectiveDomainRuleMode === "domain"} onClick={() => onDomainRuleModeChange("domain")}>
                  <span>{t("settings.classification.domain")}</span>
                </button>
                <button type="button" className={`settings-mode-option${effectiveDomainRuleMode === "url" ? " is-active" : ""}`} role="radio" aria-checked={effectiveDomainRuleMode === "url"} onClick={() => onDomainRuleModeChange("url")} disabled={!exactUrlAvailable}>
                  <span>{t("settings.classification.exactUrl")}</span>
                </button>
              </div>
            </div>
            <ClassificationPicker label={t("settings.classification.category")} ariaLabel={t("settings.classification.domainCategoryAria")} value={domainRuleCategory} options={CATEGORY_ORDER} getLabel={(category) => localizedCategoryLabel(category, t)} getColor={(category) => categoryControlColor(category, categoryColorOverrides)} onChange={onDomainRuleCategoryChange} />
            <ClassificationPicker label={t("settings.classification.productivity")} ariaLabel={t("settings.classification.domainProductivityAria")} value={domainRuleProductivity} options={PRODUCTIVITY_ORDER} getLabel={(productivity) => localizedProductivityLabel(productivity, t)} getColor={(productivity) => productivityControlColor(productivity, appThemeColorOverrides)} onChange={onDomainRuleProductivityChange} />
            <button type="button" className="settings-btn settings-btn--primary" onClick={onSaveDomainRule} disabled={classificationRuleSavingKind !== null}>{classificationRuleSavingKind === "site" ? t("settings.classification.saving") : domainRuleSaveLabel}</button>
          </div>
          {effectiveDomainRuleMode === "url" && exactUrlValue ? <p className="classification-rule-selected classification-rule-selected--url" role="status">{t("settings.classification.exactUrlSelected", { url: exactUrlValue })}</p> : null}
        </div>
        <div className="settings-row settings-row--fallback settings-row--group-end classification-rule-form">
          <div>
            <div className="lbl">{t("settings.classification.addApp")}</div>
            <div className="desc">{t("settings.classification.addAppDescription")}</div>
          </div>
          <div className="ctrl classification-rule-form__grid classification-rule-form__grid--app">
            <div ref={appRuleSearchRef} className="classification-rule-field classification-rule-field--wide classification-rule-search" onFocus={onAppRuleSearchFocus} onBlur={onAppRuleSearchBlur}>
              <label htmlFor="classification-app-rule-search">{t("settings.classification.recordedApp")}</label>
              <input id="classification-app-rule-search" className="settings-input" type="search" value={appRuleSearch} onChange={(event) => onAppRuleSearchChange(event.target.value)} placeholder={t("settings.classification.searchApps")} aria-label={t("settings.classification.appRuleAria")} autoComplete="off" aria-expanded={appRuleSearchPanelOpen} aria-controls="classification-app-rule-candidates" />
              {appRuleSearchPanelOpen ? (
                <div id="classification-app-rule-candidates" className="classification-rule-candidates classification-rule-search__popover" aria-label={t("settings.classification.recordedApps")}>
                  {classificationRuleCandidatesLoading ? <span className="classification-rule-hint">{appRuleSearch.trim() ? t("settings.classification.searchingApps") : t("settings.classification.loadingApps")}</span> : null}
                  {!classificationRuleCandidatesLoading && classificationRuleCandidates.length === 0 ? <span className="classification-rule-hint">{appRuleSearch.trim() ? t("settings.classification.noAppMatch") : t("settings.classification.noApps")}</span> : null}
                  {classificationRuleCandidates.map((candidate) => {
                    const candidateUsageLabel = localizedCandidateUsageLabel(candidate, t);
                    return (
                      <button key={candidate.id} type="button" className={`classification-rule-candidate${appRuleTargetValue === candidate.targetValue ? " is-selected" : ""}`} onMouseDown={(event) => event.preventDefault()} onClick={() => onSelectClassificationCandidate(candidate)} aria-label={t("settings.classification.chooseCandidateAria", { name: candidate.displayName, usage: candidateUsageLabel })}>
                        <span className="classification-rule-candidate__identity">
                          <AppGlyph appName={candidate.appName ?? candidate.displayName} iconSrc={classificationRuleCandidateAppIconSrc(candidate, appIcons)} size="sm" />
                          <span className="classification-rule-candidate__text"><strong>{candidate.displayName}</strong>{candidate.bundleId ? <small>{candidate.bundleId}</small> : null}</span>
                        </span>
                          <span className="classification-rule-candidate__usage"><strong>{secondsToLabel(candidate.totalSeconds)}</strong><em>{localizedSegmentCount(candidate.segmentCount, t)}</em></span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <ClassificationPicker label={t("settings.classification.category")} ariaLabel={t("settings.classification.appCategoryAria")} value={appRuleCategory} options={CATEGORY_ORDER} getLabel={(category) => localizedCategoryLabel(category, t)} getColor={(category) => categoryControlColor(category, categoryColorOverrides)} onChange={onAppRuleCategoryChange} />
            <ClassificationPicker label={t("settings.classification.productivity")} ariaLabel={t("settings.classification.appProductivityAria")} value={appRuleProductivity} options={PRODUCTIVITY_ORDER} getLabel={(productivity) => localizedProductivityLabel(productivity, t)} getColor={(productivity) => productivityControlColor(productivity, appThemeColorOverrides)} onChange={onAppRuleProductivityChange} />
            <button type="button" className="settings-btn settings-btn--primary" onClick={onSaveAppRule} disabled={classificationRuleSavingKind !== null || !appRuleTargetValue.trim()}>{classificationRuleSavingKind === "app" ? t("settings.classification.saving") : t("settings.classification.saveApp")}</button>
          </div>
          {appRuleDisplayName ? <p className="classification-rule-selected" role="status">{t("settings.classification.selectedApp", { app: appRuleDisplayName })}</p> : null}
        </div>
        {classificationRulesError ? <p className="classification-summary classification-summary--error" role="alert">{localizeSettingsError(classificationRulesError, effectiveLanguage, t)}</p> : null}
        {classificationRuleMessage ? <p className="classification-summary" role="status">{classificationRuleMessage}</p> : null}
        {classificationRuleApplyResult ? <p className="classification-summary" role="status">{localizedApplyResult(classificationRuleApplyResult, t)}</p> : null}
      </div>
      <ClassificationSavedRulesList
        appIcons={appIcons}
        classificationRuleApplying={classificationRuleApplying}
        classificationRuleDeletingId={classificationRuleDeletingId}
        classificationRuleSegments={classificationRuleSegments}
        classificationRules={classificationRules}
        classificationRulesLoading={classificationRulesLoading}
        onApplyClassificationRules={onApplyClassificationRules}
        onDeleteClassificationRule={onDeleteClassificationRule}
        onLoadClassificationRules={onLoadClassificationRules}
        onToggleClassificationRule={onToggleClassificationRule}
      />
    </div>
  );
}

function localizedCandidateUsageLabel(candidate: ClassificationRuleCandidate, t: ReturnType<typeof useLocalization>["t"]): string {
  return t(candidate.segmentCount === 1 ? "settings.classification.candidateUsageSingle" : "settings.classification.candidateUsage", {
    duration: secondsToLabel(candidate.totalSeconds),
    count: candidate.segmentCount,
  });
}

function localizedSegmentCount(count: number, t: ReturnType<typeof useLocalization>["t"]): string {
  return t(count === 1 ? "settings.classification.segment" : "settings.classification.segments", { count });
}

function localizedApplyResult(result: ClassificationRuleApplyResult, t: ReturnType<typeof useLocalization>["t"]): string {
  return t(result.matchedCount === 1 ? "settings.classification.applyResultSingle" : "settings.classification.applyResult", {
    matched: result.matchedCount,
    applied: result.appliedCount,
    skipped: result.skippedCount,
  });
}
