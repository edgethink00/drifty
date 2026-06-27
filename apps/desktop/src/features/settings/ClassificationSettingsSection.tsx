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
  formatClassificationCandidateUsageLabel,
  formatClassificationRuleApplyResult,
  normalizeDomainRuleInput,
} from "../classification/classificationViewData";
import { categoryLabel, productivityLabel } from "../../lib/activityLabels";
import {
  categoryControlColor,
  productivityControlColor,
  type AppThemeColorOverrides,
  type CategoryColorOverrides,
} from "./settingsStorage";
import { ClassificationSavedRulesList } from "./ClassificationSavedRulesList";
import { ClassificationPicker } from "./SettingsColorControls";

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
  const exactUrlValue = canonicalizeClassificationRuleSiteUrl(domainRuleInput);
  const exactUrlAvailable = Boolean(exactUrlValue);
  const effectiveDomainRuleMode = domainRuleMode === "url" && exactUrlAvailable ? "url" : "domain";
  const domainRuleSaveLabel = effectiveDomainRuleMode === "url" ? "Save URL rule" : "Save Domain rule";

  return (
    <div className="settings-section settings-section--classification">
      <div className="settings-block cloud-overview">
        <h3>Classification</h3>
        <div className="settings-row">
          <div>
            <div className="lbl">Classification rules</div>
            <div className="desc">Create local rules for domains and recorded apps. Rules stay on this Mac and are never synced to Drifty Cloud.</div>
          </div>
          <div className="ctrl"><span className="chip green">Local only</span></div>
        </div>
        <div className="settings-row settings-row--fallback classification-rule-form">
          <div>
            <div className="lbl">Add Domain rule</div>
            <div className="desc">Type a domain for a whole-site rule, or paste a URL and choose Exact URL for a one-page rule.</div>
          </div>
          <div className="ctrl classification-rule-form__grid">
            <div ref={domainRuleSearchRef} className="classification-rule-field classification-rule-field--wide classification-rule-search" onFocus={onDomainRuleSearchFocus} onBlur={onDomainRuleSearchBlur}>
              <label htmlFor="classification-domain-rule-search">Domain or URL</label>
              <input id="classification-domain-rule-search" className="settings-input" type="search" value={domainRuleInput} onChange={(event) => onDomainRuleInputChange(event.target.value)} placeholder="example.com" aria-label="Domain rule domain or URL" autoComplete="off" aria-expanded={domainRuleSearchPanelOpen} aria-controls="classification-domain-rule-candidates" />
              {domainRuleSearchPanelOpen ? (
                <div id="classification-domain-rule-candidates" className="classification-rule-candidates classification-rule-search__popover" aria-label="Recorded site suggestions">
                  {domainRuleCandidatesLoading ? <span className="classification-rule-hint">{domainRuleInput.trim() ? "Searching local site history..." : "Loading most-used sites..."}</span> : null}
                  {!domainRuleCandidatesLoading && domainRuleCandidates.length === 0 ? <span className="classification-rule-hint">{domainRuleInput.trim() ? "No recorded sites match this search." : "No recorded sites recorded yet."}</span> : null}
                  {domainRuleCandidates.map((candidate) => {
                    const candidateUsageLabel = formatClassificationCandidateUsageLabel(candidate);
                    const siteDomain = candidate.siteDomain ?? candidate.targetValue;
                    const siteDetail = candidate.siteTitle || candidate.browserName || "Recorded site";
                    return (
                      <button key={candidate.id} type="button" className={`classification-rule-candidate${normalizeDomainRuleInput(domainRuleInput) === candidate.targetValue ? " is-selected" : ""}`} onMouseDown={(event) => event.preventDefault()} onClick={() => onSelectDomainRuleCandidate(candidate)} aria-label={`Choose ${candidate.displayName}, ${candidateUsageLabel}`}>
                        <span className="classification-rule-candidate__identity">
                          <SiteFavicon domain={siteDomain} size={20} />
                          <span className="classification-rule-candidate__text"><strong>{candidate.displayName}</strong><small>{siteDetail}</small></span>
                        </span>
                        <span className="classification-rule-candidate__usage"><strong>{secondsToLabel(candidate.totalSeconds)}</strong><em>{candidate.segmentCount} {candidate.segmentCount === 1 ? "segment" : "segments"}</em></span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <div className="classification-rule-field classification-rule-mode-field">
              <span>Rule type</span>
              <div className="settings-mode-switch settings-mode-switch--compact classification-rule-mode-control" role="radiogroup" aria-label="Domain rule type">
                <button type="button" className={`settings-mode-option${effectiveDomainRuleMode === "domain" ? " is-active" : ""}`} role="radio" aria-checked={effectiveDomainRuleMode === "domain"} onClick={() => onDomainRuleModeChange("domain")}>
                  <span>Domain</span>
                </button>
                <button type="button" className={`settings-mode-option${effectiveDomainRuleMode === "url" ? " is-active" : ""}`} role="radio" aria-checked={effectiveDomainRuleMode === "url"} onClick={() => onDomainRuleModeChange("url")} disabled={!exactUrlAvailable}>
                  <span>Exact URL</span>
                </button>
              </div>
            </div>
            <ClassificationPicker label="Category" ariaLabel="Domain rule category" value={domainRuleCategory} options={CATEGORY_ORDER} getLabel={categoryLabel} getColor={(category) => categoryControlColor(category, categoryColorOverrides)} onChange={onDomainRuleCategoryChange} />
            <ClassificationPicker label="Productivity" ariaLabel="Domain rule productivity" value={domainRuleProductivity} options={PRODUCTIVITY_ORDER} getLabel={productivityLabel} getColor={(productivity) => productivityControlColor(productivity, appThemeColorOverrides)} onChange={onDomainRuleProductivityChange} />
            <button type="button" className="settings-btn settings-btn--primary" onClick={onSaveDomainRule} disabled={classificationRuleSavingKind !== null}>{classificationRuleSavingKind === "site" ? "Saving..." : domainRuleSaveLabel}</button>
          </div>
          {effectiveDomainRuleMode === "url" && exactUrlValue ? <p className="classification-rule-selected classification-rule-selected--url" role="status">Exact URL: {exactUrlValue}</p> : null}
        </div>
        <div className="settings-row settings-row--fallback settings-row--group-end classification-rule-form">
          <div>
            <div className="lbl">Add App rule</div>
            <div className="desc">Search app names Drifty has recorded locally. This creates a broad App rule, not a window-title detail rule.</div>
          </div>
          <div className="ctrl classification-rule-form__grid classification-rule-form__grid--app">
            <div ref={appRuleSearchRef} className="classification-rule-field classification-rule-field--wide classification-rule-search" onFocus={onAppRuleSearchFocus} onBlur={onAppRuleSearchBlur}>
              <label htmlFor="classification-app-rule-search">Recorded app</label>
              <input id="classification-app-rule-search" className="settings-input" type="search" value={appRuleSearch} onChange={(event) => onAppRuleSearchChange(event.target.value)} placeholder="Search apps..." aria-label="Search recorded apps for App rule" autoComplete="off" aria-expanded={appRuleSearchPanelOpen} aria-controls="classification-app-rule-candidates" />
              {appRuleSearchPanelOpen ? (
                <div id="classification-app-rule-candidates" className="classification-rule-candidates classification-rule-search__popover" aria-label="Recorded app suggestions">
                  {classificationRuleCandidatesLoading ? <span className="classification-rule-hint">{appRuleSearch.trim() ? "Searching local app history..." : "Loading most-used apps..."}</span> : null}
                  {!classificationRuleCandidatesLoading && classificationRuleCandidates.length === 0 ? <span className="classification-rule-hint">{appRuleSearch.trim() ? "No recorded apps match this search." : "No recorded apps recorded yet."}</span> : null}
                  {classificationRuleCandidates.map((candidate) => {
                    const candidateUsageLabel = formatClassificationCandidateUsageLabel(candidate);
                    return (
                      <button key={candidate.id} type="button" className={`classification-rule-candidate${appRuleTargetValue === candidate.targetValue ? " is-selected" : ""}`} onMouseDown={(event) => event.preventDefault()} onClick={() => onSelectClassificationCandidate(candidate)} aria-label={`Choose ${candidate.displayName}, ${candidateUsageLabel}`}>
                        <span className="classification-rule-candidate__identity">
                          <AppGlyph appName={candidate.appName ?? candidate.displayName} iconSrc={classificationRuleCandidateAppIconSrc(candidate, appIcons)} size="sm" />
                          <span className="classification-rule-candidate__text"><strong>{candidate.displayName}</strong>{candidate.bundleId ? <small>{candidate.bundleId}</small> : null}</span>
                        </span>
                        <span className="classification-rule-candidate__usage"><strong>{secondsToLabel(candidate.totalSeconds)}</strong><em>{candidate.segmentCount} {candidate.segmentCount === 1 ? "segment" : "segments"}</em></span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <ClassificationPicker label="Category" ariaLabel="App rule category" value={appRuleCategory} options={CATEGORY_ORDER} getLabel={categoryLabel} getColor={(category) => categoryControlColor(category, categoryColorOverrides)} onChange={onAppRuleCategoryChange} />
            <ClassificationPicker label="Productivity" ariaLabel="App rule productivity" value={appRuleProductivity} options={PRODUCTIVITY_ORDER} getLabel={productivityLabel} getColor={(productivity) => productivityControlColor(productivity, appThemeColorOverrides)} onChange={onAppRuleProductivityChange} />
            <button type="button" className="settings-btn settings-btn--primary" onClick={onSaveAppRule} disabled={classificationRuleSavingKind !== null || !appRuleTargetValue.trim()}>{classificationRuleSavingKind === "app" ? "Saving..." : "Save App rule"}</button>
          </div>
          {appRuleDisplayName ? <p className="classification-rule-selected" role="status">Selected app: {appRuleDisplayName}</p> : null}
        </div>
        {classificationRulesError ? <p className="classification-summary classification-summary--error" role="alert">{classificationRulesError}</p> : null}
        {classificationRuleMessage ? <p className="classification-summary" role="status">{classificationRuleMessage}</p> : null}
        {classificationRuleApplyResult ? <p className="classification-summary" role="status">{formatClassificationRuleApplyResult(classificationRuleApplyResult)}</p> : null}
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
