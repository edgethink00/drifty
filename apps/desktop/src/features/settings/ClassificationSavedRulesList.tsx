import { useState, type SyntheticEvent, type ReactNode } from "react";
import { ClassificationPicker } from "./SettingsColorControls";
import { categoryControlColor, productivityControlColor, type AppThemeColorOverrides, type CategoryColorOverrides } from "./settingsStorage";
import {
  CATEGORY_ORDER,
  PRODUCTIVITY_ORDER,
  canonicalizeClassificationRuleSiteUrl,
  type ClassificationRuleInput,
  type ActivitySegment,
  type AppIconMap,
  type ClassificationRule,
} from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { Toggle } from "../../components/Toggle";
import { localizedCategoryLabel, localizedProductivityLabel } from "../localization/activityTranslations";
import { useLocalization } from "../localization/LocalizationContext";
import {
  classificationActivityLabel,
  classificationRuleAppIconSrc,
} from "../classification/classificationViewData";
import type { LocalizationController } from "../localization/LocalizationContext";

type ClassificationSavedRulesListProps = {
  readonly feedback?: ReactNode;
  readonly hasError: boolean;
  readonly onSaveRule: (input: ClassificationRuleInput) => Promise<boolean>;
  readonly saving: boolean;
  readonly appThemeColorOverrides: AppThemeColorOverrides;
  readonly categoryColorOverrides: CategoryColorOverrides;

  readonly appIcons: AppIconMap;
  readonly classificationRuleDeletingId: string | null;
  readonly classificationRuleSegments: readonly ActivitySegment[];
  readonly classificationRules: readonly ClassificationRule[];
  readonly classificationRulesLoading: boolean;
  readonly onDeleteClassificationRule: (rule: ClassificationRule) => void;
  readonly onLoadClassificationRules: () => void;
  readonly onToggleClassificationRule: (rule: ClassificationRule, enabled: boolean) => void;
};

export function ClassificationSavedRulesList({
  feedback,
  hasError,
  onSaveRule,
  saving,
  appThemeColorOverrides,
  categoryColorOverrides,
  appIcons,
  classificationRuleDeletingId,
  classificationRuleSegments,
  classificationRules,
  classificationRulesLoading,
  onDeleteClassificationRule,
  onLoadClassificationRules,
  onToggleClassificationRule,
}: ClassificationSavedRulesListProps) {
  const { t } = useLocalization();
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const visibleRules = classificationRules.filter((rule) => !query || [rule.targetValue, rule.detailValue, classificationRuleDisplayTitle(rule, classificationRuleSegments), localizedCategoryLabel(rule.category, t), localizedProductivityLabel(rule.productivity, t)].filter(Boolean).join(" ").toLocaleLowerCase().includes(query));
  return (
    <div className="settings-block classification-rule-saved-block">
      <h3 id="classification-saved-rules-heading">{t("classification.rules.title")}</h3>
      {feedback}
      <section className="settings-row settings-row--group-start settings-row--group-end classification-rule-list-section" aria-labelledby="classification-saved-rules-heading">
        <p className="classification-rules-manager__intro">{t("classification.rules.description")}</p>
        <div className="classification-rule-list-head">
          <span className="classification-rule-list-count" role="status">{!hasError && !classificationRulesLoading ? t(query ? "classification.rules.count" : "classification.rules.totalCount", { count: visibleRules.length, total: classificationRules.length }) : null}</span>
          <div className="classification-rule-list-tools">
            {classificationRules.length > 8 || search ? <input type="search" className="settings-input" aria-label={t("classification.rules.search")} placeholder={t("classification.rules.search")} value={search} onChange={(event) => setSearch(event.target.value)} /> : null}
            <button type="button" className="settings-btn" onClick={onLoadClassificationRules} disabled={classificationRulesLoading}>{t("settings.classification.refresh")}</button>
          </div>
        </div>
        {(!hasError || visibleRules.length > 0 || classificationRulesLoading) ? <div className="classification-rule-list-shell">
          {classificationRulesLoading ? <p className="classification-rule-hint">{t("settings.classification.loadingRules")}</p> : null}
          {!hasError && !classificationRulesLoading && classificationRules.length === 0 ? (
            <div className="empty-state classification-rule-empty">
              <strong>{t("settings.classification.noCustomRules")}</strong>
              <p>{t("settings.classification.noRulesDescription")}</p>
            </div>
          ) : null}
        {query && visibleRules.length === 0 && classificationRules.length > 0 ? <p className="classification-rule-hint" role="status">{t("classification.rules.noSearchResults")}</p> : null}
          {visibleRules.length > 0 ? (
            <div className="classification-rule-list" tabIndex={0} role="region" aria-label={t("settings.classification.savedRulesAria")}>
              {visibleRules.map((rule) => (
                <ClassificationSavedRuleCard
                  onSaveRule={onSaveRule}
                  saving={saving}
                  appThemeColorOverrides={appThemeColorOverrides}
                  categoryColorOverrides={categoryColorOverrides}
                  key={rule.id}
                  appIcons={appIcons}
                  classificationRuleDeletingId={classificationRuleDeletingId}
                  classificationRuleSegments={classificationRuleSegments}
                  rule={rule}
                  t={t}
                  onDeleteClassificationRule={onDeleteClassificationRule}
                  onToggleClassificationRule={onToggleClassificationRule}
                />
              ))}
            </div>
          ) : null}
        </div> : null}
        <details className="classification-rules-manager__help">
          <summary>{t("classification.rules.help")}</summary>
          <p>{t("settings.classification.savedRulesDescription")}</p>
        </details>
      </section>
    </div>
  );
}

type ClassificationSavedRuleCardProps = {
  readonly onSaveRule: (input: ClassificationRuleInput) => Promise<boolean>;
  readonly saving: boolean;
  readonly appThemeColorOverrides: AppThemeColorOverrides;
  readonly categoryColorOverrides: CategoryColorOverrides;

  readonly appIcons: AppIconMap;
  readonly classificationRuleDeletingId: string | null;
  readonly classificationRuleSegments: readonly ActivitySegment[];
  readonly rule: ClassificationRule;
  readonly t: LocalizationController["t"];
  readonly onDeleteClassificationRule: (rule: ClassificationRule) => void;
  readonly onToggleClassificationRule: (rule: ClassificationRule, enabled: boolean) => void;
};

function ClassificationSavedRuleCard({
  onSaveRule,
  saving,
  appThemeColorOverrides,
  categoryColorOverrides,
  appIcons,
  classificationRuleDeletingId,
  classificationRuleSegments,
  rule,
  t,
  onDeleteClassificationRule,
  onToggleClassificationRule,
}: ClassificationSavedRuleCardProps) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [category, setCategory] = useState(rule.category);
  const [productivity, setProductivity] = useState(rule.productivity);
  const busy = saving || classificationRuleDeletingId !== null;
  const detailKindLabel = localizedRuleDetailKindLabel(rule.detailKind, t);
  const detailLabel = rule.matchScope === "detail" && rule.detailValue ? `${detailKindLabel}: ${rule.detailValue}` : null;
  const surfaceLabel = `${localizedRuleSurfaceLabel(rule, t)}: ${rule.targetValue}`;
  const displayTitle = classificationRuleDisplayTitle(rule, classificationRuleSegments)
    ?? (rule.targetKind === "app" ? classificationRuleSegments.find((segment) => segment.bundleId === rule.targetValue)?.appName : null);
  const primaryLabel = displayTitle ?? surfaceLabel;
  const scopeLabel = localizedRuleScopeLabel(rule, t);
  const metadataLabel = `${displayTitle ? `${surfaceLabel} · ` : ""}${localizedCategoryLabel(rule.category, t)} · ${localizedProductivityLabel(rule.productivity, t)} · ${rule.enabled ? t("common.enabled") : t("common.disabled")}`;

  return (
    <article className="classification-rule-card" aria-label={t("settings.classification.ruleCardAria", { type: scopeLabel, value: displayTitle ?? rule.targetValue })}>
      <div className="classification-rule-card__main">
        <span className="classification-rule-card__icon">
          {rule.targetKind === "site" ? <SiteFavicon domain={rule.targetValue} size={24} /> : <AppGlyph appName={rule.targetValue} iconSrc={classificationRuleAppIconSrc(rule, appIcons)} size="sm" />}
        </span>
        <span className="chip gray">{scopeLabel}</span>
        <div className="classification-rule-card__text">
          <strong title={primaryLabel}>{primaryLabel}</strong>
          <p className="classification-rule-card__meta">
            {metadataLabel}
            {detailLabel ? <> · <span className="classification-rule-card__detail" title={detailLabel}>{detailLabel}</span></> : null}
          </p>
        </div>
      </div>
      <div className="classification-rule-card__actions">
        <Toggle disabled={busy} checked={rule.enabled} onChange={(enabled) => onToggleClassificationRule(rule, enabled)} ariaLabel={t(rule.enabled ? "settings.classification.disableRuleAria" : "settings.classification.enableRuleAria", { value: rule.targetValue })} />
        <button type="button" className="settings-btn" disabled={busy} onClick={() => { setCategory(rule.category); setProductivity(rule.productivity); setEditing(true); setConfirmDelete(false); }}>{t("classification.rules.edit")}</button>
        <button type="button" className="settings-btn danger classification-rule-card__delete" onClick={() => { setConfirmDelete(true); setEditing(false); }} disabled={busy}>{t("settings.classification.delete")}</button>
      </div>
      {editing ? (
        <form className="classification-rule-card__editor" onClick={revealOpenPicker} onKeyUp={revealOpenPicker} aria-label={t("classification.rules.editTarget", { target: primaryLabel })} onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const saved = await onSaveRule({ targetKind: rule.targetKind, targetValue: rule.targetValue, matchScope: rule.matchScope, detailKind: rule.detailKind, detailValue: rule.detailValue, category, productivity, enabled: rule.enabled, confidence: rule.confidence });
          if (saved) setEditing(false);
        }}>
          <fieldset disabled={busy}>
            <ClassificationPicker label={t("settings.classification.category")} ariaLabel={t("settings.classification.category")} value={category} options={CATEGORY_ORDER} getLabel={(value) => localizedCategoryLabel(value, t)} getColor={(value) => categoryControlColor(value, categoryColorOverrides)} onChange={setCategory} />
            <ClassificationPicker label={t("settings.classification.productivity")} ariaLabel={t("settings.classification.productivity")} value={productivity} options={PRODUCTIVITY_ORDER} getLabel={(value) => localizedProductivityLabel(value, t)} getColor={(value) => productivityControlColor(value, appThemeColorOverrides)} onChange={setProductivity} variant="productivity" />
          </fieldset>
          <p>{t("classification.rules.editNotice")}</p>
          <div className="classification-rule-card__form-actions">
            <button type="button" className="settings-btn" onClick={() => setEditing(false)} disabled={busy}>{t("common.cancel")}</button>
            <button type="submit" className="settings-btn settings-btn--primary" disabled={busy}>{t(busy ? "settings.classification.saving" : "classification.rules.save")}</button>
          </div>
        </form>
      ) : null}
      {confirmDelete ? (
        <div className="classification-rule-card__confirmation" role="group" aria-label={t("classification.rules.removeConfirm")}>
          <p>{t("classification.rules.removeDescription")}</p>
          <div className="classification-rule-card__form-actions">
          <button type="button" className="settings-btn" disabled={busy} onClick={() => setConfirmDelete(false)}>{t("common.cancel")}</button>
          <button type="button" className="settings-btn danger" disabled={busy} onClick={() => onDeleteClassificationRule(rule)}>{t("classification.rules.removeConfirm")}</button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function revealOpenPicker(event: SyntheticEvent<HTMLFormElement>) {
  const form = event.currentTarget;
  requestAnimationFrame(() => form.querySelector<HTMLElement>('[role="listbox"]')?.scrollIntoView?.({ block: "nearest" }));
}

function localizedRuleTargetLabel(targetKind: ClassificationRule["targetKind"], t: LocalizationController["t"]): string {
  return targetKind === "site" ? t("settings.classification.domain") : t("settings.classification.app");
}

function localizedRuleSurfaceLabel(rule: Pick<ClassificationRule, "targetKind">, t: LocalizationController["t"]): string {
  return rule.targetKind === "site" ? t("settings.classification.site") : t("settings.classification.app");
}

function localizedRuleScopeLabel(rule: Pick<ClassificationRule, "matchScope" | "targetKind" | "detailKind">, t: LocalizationController["t"]): string {
  return rule.matchScope === "detail" ? localizedRuleDetailKindLabel(rule.detailKind, t) : localizedRuleTargetLabel(rule.targetKind, t);
}

function localizedRuleDetailKindLabel(detailKind: ClassificationRule["detailKind"], t: LocalizationController["t"]): string {
  switch (detailKind) {
    case "title": return t("settings.classification.title");
    case "windowTitle": return t("settings.classification.windowTitle");
    case "siteTitle": return t("settings.classification.pageTitle");
    case "youtubeTitle": return t("settings.classification.youtubeTitle");
    case "siteUrl": return "URL";
    default: return t("settings.classification.detail");
  }
}

function classificationRuleDisplayTitle(rule: ClassificationRule, segments: readonly ActivitySegment[]): string | null {
  if (rule.matchScope !== "detail" || rule.detailKind !== "siteUrl" || !rule.detailValue) return null;

  const ruleUrl = canonicalizeClassificationRuleSiteUrl(rule.detailValue);
  if (!ruleUrl) return null;

  for (const segment of segments) {
    if (canonicalizeClassificationRuleSiteUrl(segment.siteUrl) !== ruleUrl) continue;
    const label = classificationActivityLabel(segment);
    if (isReadableClassificationRuleTitle(label, rule)) return label;
  }

  return null;
}

function isReadableClassificationRuleTitle(label: string, rule: ClassificationRule): boolean {
  const normalized = label.trim().toLowerCase();
  return Boolean(normalized) && normalized !== "[link]" && normalized !== rule.targetValue.trim().toLowerCase();
}
