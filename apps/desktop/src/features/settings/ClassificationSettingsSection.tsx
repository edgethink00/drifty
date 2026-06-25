import type { FocusEvent, RefObject } from "react";
import {
  CATEGORY_ORDER,
  PRODUCTIVITY_ORDER,
  secondsToLabel,
  type ActivityCategory,
  type AppIconMap,
  type ClassificationRule,
  type ClassificationRuleApplyResult,
  type ClassificationRuleCandidate,
  type ClassificationRuleTargetKind,
  type ProductivityLabel,
} from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { Toggle } from "../../components/Toggle";
import {
  classificationRuleAppIconSrc,
  classificationRuleCandidateAppIconSrc,
  classificationRuleDetailKindLabel,
  classificationRuleScopeLabel,
  classificationRuleTargetLabel,
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
import { ClassificationPicker } from "./SettingsColorControls";

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
  readonly classificationRules: ClassificationRule[];
  readonly classificationRulesError: string | null;
  readonly classificationRulesLoading: boolean;
  readonly domainRuleCandidates: ClassificationRuleCandidate[];
  readonly domainRuleCandidatesLoading: boolean;
  readonly domainRuleCategory: ActivityCategory;
  readonly domainRuleInput: string;
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
  classificationRules,
  classificationRulesError,
  classificationRulesLoading,
  domainRuleCandidates,
  domainRuleCandidatesLoading,
  domainRuleCategory,
  domainRuleInput,
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
            <div className="desc">Type a domain or paste a URL. Drifty stores the normalized domain locally.</div>
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
            <ClassificationPicker label="Category" ariaLabel="Domain rule category" value={domainRuleCategory} options={CATEGORY_ORDER} getLabel={categoryLabel} getColor={(category) => categoryControlColor(category, categoryColorOverrides)} onChange={onDomainRuleCategoryChange} />
            <ClassificationPicker label="Productivity" ariaLabel="Domain rule productivity" value={domainRuleProductivity} options={PRODUCTIVITY_ORDER} getLabel={productivityLabel} getColor={(productivity) => productivityControlColor(productivity, appThemeColorOverrides)} onChange={onDomainRuleProductivityChange} />
            <button type="button" className="settings-btn settings-btn--primary" onClick={onSaveDomainRule} disabled={classificationRuleSavingKind !== null}>{classificationRuleSavingKind === "site" ? "Saving..." : "Save Domain rule"}</button>
          </div>
        </div>
        <div className="settings-row settings-row--fallback settings-row--group-end classification-rule-form">
          <div>
            <div className="lbl">Add App rule</div>
            <div className="desc">Search app names Drifty has recorded locally, then choose category and productivity.</div>
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
      <div className="settings-block">
        <h3>Saved local rules</h3>
        <div className="settings-row settings-row--group-end classification-rule-list-head">
          <div>
            <div className="lbl">Saved local rules</div>
            <div className="desc">Use the switch to save a rule as off, delete it, or reapply enabled rules to existing activity.</div>
          </div>
          <div className="ctrl settings-row__actions">
            <button type="button" className="settings-btn" onClick={onLoadClassificationRules} disabled={classificationRulesLoading}>Refresh</button>
            <button type="button" className="settings-btn settings-btn--primary" onClick={onApplyClassificationRules} disabled={classificationRuleApplying || classificationRules.length === 0}>{classificationRuleApplying ? "Applying..." : "Apply rules"}</button>
          </div>
        </div>
        {classificationRulesLoading ? <p className="classification-rule-hint">Loading local rules...</p> : null}
        {!classificationRulesLoading && classificationRules.length === 0 ? (
          <div className="empty-state classification-rule-empty">
            <span className="eyebrow">No local rules</span>
            <strong>No custom rules yet</strong>
            <p>Add a Domain or App rule to override local classification for matching activity.</p>
          </div>
        ) : null}
        {classificationRules.length > 0 ? (
          <div className="classification-rule-list" aria-label="Saved local classification rules">
            {classificationRules.map((rule) => {
              const detailLabel = rule.matchScope === "detail" && rule.detailValue
                ? `${classificationRuleDetailKindLabel(rule.detailKind)}: ${rule.detailValue}`
                : null;
              return (
                <article className="classification-rule-card" key={rule.id} aria-label={`${classificationRuleTargetLabel(rule.targetKind)} rule ${rule.targetValue}`}>
                  <div className="classification-rule-card__main">
                    <span className="classification-rule-card__icon">
                      {rule.targetKind === "site" ? <SiteFavicon domain={rule.targetValue} size={24} /> : <AppGlyph appName={rule.targetValue} iconSrc={classificationRuleAppIconSrc(rule, appIcons)} size="sm" />}
                    </span>
                    <span className="chip gray">{rule.matchScope === "detail" ? "Detail" : classificationRuleTargetLabel(rule.targetKind)}</span>
                    <div>
                      <strong>{rule.targetValue}</strong>
                      <p>{classificationRuleScopeLabel(rule)} · {categoryLabel(rule.category)} · {productivityLabel(rule.productivity)} · {rule.enabled ? "Enabled" : "Disabled"}</p>
                      {detailLabel ? <p className="classification-rule-card__detail">{detailLabel}</p> : null}
                    </div>
                  </div>
                  <div className="classification-rule-card__actions">
                    <Toggle checked={rule.enabled} onChange={(enabled) => onToggleClassificationRule(rule, enabled)} ariaLabel={`${rule.enabled ? "Disable" : "Enable"} ${rule.targetValue} rule`} />
                    <button type="button" className="settings-btn danger" onClick={() => onDeleteClassificationRule(rule)} disabled={classificationRuleDeletingId === rule.id}>{classificationRuleDeletingId === rule.id ? "Deleting..." : "Delete"}</button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
