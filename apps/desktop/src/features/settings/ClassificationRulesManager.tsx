import { useEffect, useRef } from "react";
import { useSettingsSearch } from "./SettingsSearchContext";
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
  type ClassificationRuleInput,
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

type ClassificationRulesManagerProps = {
  readonly onSaveRule: (input: ClassificationRuleInput) => Promise<boolean>;
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

export function ClassificationRulesManager({
  onSaveRule,
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
}: ClassificationRulesManagerProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { request } = useSettingsSearch();
  const addDetailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (request?.entry.reveal === "classification-add" && addDetailsRef.current) addDetailsRef.current.open = true;
  }, [request]);
  const exactUrlValue = canonicalizeClassificationRuleSiteUrl(domainRuleInput);
  const exactUrlAvailable = Boolean(exactUrlValue);
  const effectiveDomainRuleMode = domainRuleMode === "url" && exactUrlAvailable ? "url" : "domain";
  const domainRuleSaveLabel = effectiveDomainRuleMode === "url" ? t("settings.classification.saveUrl") : t("settings.classification.saveDomain");

  return (
    <div data-setting-id="classification.rules.title" className="settings-section settings-section--classification classification-rules-manager">
      <ClassificationSavedRulesList
        feedback={classificationRulesError ? (
          <div className="classification-rules-manager__notice classification-rules-manager__notice--error" role="alert">{localizeSettingsError(classificationRulesError, effectiveLanguage, t)}</div>
        ) : classificationRuleMessage || classificationRuleApplyResult ? (
          <div className="classification-rules-manager__notice" role="status">
            {classificationRuleMessage ? <strong>{classificationRuleMessage}</strong> : null}
            {classificationRuleApplyResult ? <span>{localizedApplyResult(classificationRuleApplyResult, t)}</span> : null}
          </div>
        ) : null}
        hasError={Boolean(classificationRulesError)}
        onSaveRule={onSaveRule}
        saving={classificationRuleSavingKind !== null}
        appThemeColorOverrides={appThemeColorOverrides}
        categoryColorOverrides={categoryColorOverrides}
        appIcons={appIcons}
        classificationRuleDeletingId={classificationRuleDeletingId}
        classificationRuleSegments={classificationRuleSegments}
        classificationRules={classificationRules}
        classificationRulesLoading={classificationRulesLoading}
        onDeleteClassificationRule={onDeleteClassificationRule}
        onLoadClassificationRules={onLoadClassificationRules}
        onToggleClassificationRule={onToggleClassificationRule}
      />
      <details ref={addDetailsRef} className="classification-rules-manager__add">
        <summary>{t("classification.rules.add")}</summary>

        <div className="settings-block cloud-overview">
          <h3 className="sr-only">{t("classification.rules.add")}</h3>
          <div data-setting-id="settings.classification.addDomain" className="settings-row settings-row--fallback classification-rule-form">
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
                    {!domainRuleCandidatesLoading && domainRuleCandidates.length === 0 ? <span className="classification-rule-hint">{domainRuleInput.trim() ? t(exactUrlAvailable ? "classification.rules.newSiteHint" : "settings.classification.noSiteMatch") : t("settings.classification.noSites")}</span> : null}
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
              {exactUrlAvailable ? (
                <div className="classification-rule-field classification-rule-scope-field">
                  <span>{t("classification.rules.scopeLabel")}</span>
                    <div className="settings-mode-switch settings-mode-switch--compact classification-rule-mode-control" role="radiogroup" aria-label={t("settings.classification.ruleType")}>
                      <button type="button" className={`settings-mode-option${effectiveDomainRuleMode === "domain" ? " is-active" : ""}`} role="radio" aria-checked={effectiveDomainRuleMode === "domain"} onClick={() => onDomainRuleModeChange("domain")}>
                        <span>{t("settings.classification.domain")}</span>
                      </button>
                      <button type="button" className={`settings-mode-option${effectiveDomainRuleMode === "url" ? " is-active" : ""}`} role="radio" aria-checked={effectiveDomainRuleMode === "url"} onClick={() => onDomainRuleModeChange("url")}>
                        <span>{t("settings.classification.exactUrl")}</span>
                      </button>
                    </div>
                </div>
              ) : null}
              <ClassificationPicker label={t("settings.classification.category")} ariaLabel={t("settings.classification.domainCategoryAria")} value={domainRuleCategory} options={CATEGORY_ORDER} getLabel={(category) => localizedCategoryLabel(category, t)} getColor={(category) => categoryControlColor(category, categoryColorOverrides)} onChange={onDomainRuleCategoryChange} />
              <ClassificationPicker label={t("settings.classification.productivity")} ariaLabel={t("settings.classification.domainProductivityAria")} value={domainRuleProductivity} options={PRODUCTIVITY_ORDER} getLabel={(productivity) => localizedProductivityLabel(productivity, t)} getColor={(productivity) => productivityControlColor(productivity, appThemeColorOverrides)} onChange={onDomainRuleProductivityChange} variant="productivity" />
              <button type="button" className="settings-btn settings-btn--primary" onClick={onSaveDomainRule} disabled={classificationRuleSavingKind !== null}>{classificationRuleSavingKind === "site" ? t("settings.classification.saving") : domainRuleSaveLabel}</button>
            </div>
            {effectiveDomainRuleMode === "url" && exactUrlValue ? <p className="classification-rule-selected classification-rule-selected--url" role="status">{t("settings.classification.exactUrlSelected", { url: exactUrlValue })}</p> : null}
          </div>
          <div data-setting-id="settings.classification.addApp" className="settings-row settings-row--fallback settings-row--group-end classification-rule-form">
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
              <ClassificationPicker label={t("settings.classification.productivity")} ariaLabel={t("settings.classification.appProductivityAria")} value={appRuleProductivity} options={PRODUCTIVITY_ORDER} getLabel={(productivity) => localizedProductivityLabel(productivity, t)} getColor={(productivity) => productivityControlColor(productivity, appThemeColorOverrides)} onChange={onAppRuleProductivityChange} variant="productivity" />
              <button type="button" className="settings-btn settings-btn--primary" onClick={onSaveAppRule} disabled={classificationRuleSavingKind !== null}>{classificationRuleSavingKind === "app" ? t("settings.classification.saving") : t("settings.classification.saveApp")}</button>
            </div>
            {appRuleDisplayName ? <p className="classification-rule-selected" role="status">{t("settings.classification.selectedApp", { app: appRuleDisplayName })}</p> : null}
          </div>
        </div>
      </details>
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
  return t("classification.rules.applySummary", {
    matched: result.matchedCount,
    applied: result.appliedCount,
    skipped: result.skippedCount,
  });
}
