import {
  canonicalizeClassificationRuleSiteUrl,
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
  readonly appIcons: AppIconMap;
  readonly classificationRuleApplying: boolean;
  readonly classificationRuleDeletingId: string | null;
  readonly classificationRuleSegments: readonly ActivitySegment[];
  readonly classificationRules: readonly ClassificationRule[];
  readonly classificationRulesLoading: boolean;
  readonly onApplyClassificationRules: () => void;
  readonly onDeleteClassificationRule: (rule: ClassificationRule) => void;
  readonly onLoadClassificationRules: () => void;
  readonly onToggleClassificationRule: (rule: ClassificationRule, enabled: boolean) => void;
};

export function ClassificationSavedRulesList({
  appIcons,
  classificationRuleApplying,
  classificationRuleDeletingId,
  classificationRuleSegments,
  classificationRules,
  classificationRulesLoading,
  onApplyClassificationRules,
  onDeleteClassificationRule,
  onLoadClassificationRules,
  onToggleClassificationRule,
}: ClassificationSavedRulesListProps) {
  const { t } = useLocalization();
  return (
    <div className="settings-block classification-rule-saved-block">
      <h3 id="classification-saved-rules-heading">{t("settings.classification.savedRules")}</h3>
      <section className="settings-row settings-row--group-end classification-rule-list-section" aria-labelledby="classification-saved-rules-heading">
        <div className="classification-rule-list-head">
          <div>
            <div className="lbl">{t("settings.classification.savedRules")}</div>
            <div className="desc">{t("settings.classification.savedRulesDescription")}</div>
          </div>
          <div className="ctrl settings-row__actions">
            <button type="button" className="settings-btn" onClick={onLoadClassificationRules} disabled={classificationRulesLoading}>{t("settings.classification.refresh")}</button>
            <button type="button" className="settings-btn settings-btn--primary" onClick={onApplyClassificationRules} disabled={classificationRuleApplying || classificationRules.length === 0}>{classificationRuleApplying ? t("settings.classification.applying") : t("settings.classification.applyRules")}</button>
          </div>
        </div>
        <div className="classification-rule-list-shell">
          {classificationRulesLoading ? <p className="classification-rule-hint">{t("settings.classification.loadingRules")}</p> : null}
          {!classificationRulesLoading && classificationRules.length === 0 ? (
            <div className="empty-state classification-rule-empty">
              <span className="eyebrow">{t("settings.classification.noLocalRules")}</span>
              <strong>{t("settings.classification.noCustomRules")}</strong>
              <p>{t("settings.classification.noRulesDescription")}</p>
            </div>
          ) : null}
          {classificationRules.length > 0 ? (
            <div className="classification-rule-list" aria-label={t("settings.classification.savedRulesAria")}>
              {classificationRules.map((rule) => (
                <ClassificationSavedRuleCard
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
        </div>
      </section>
    </div>
  );
}

type ClassificationSavedRuleCardProps = {
  readonly appIcons: AppIconMap;
  readonly classificationRuleDeletingId: string | null;
  readonly classificationRuleSegments: readonly ActivitySegment[];
  readonly rule: ClassificationRule;
  readonly t: LocalizationController["t"];
  readonly onDeleteClassificationRule: (rule: ClassificationRule) => void;
  readonly onToggleClassificationRule: (rule: ClassificationRule, enabled: boolean) => void;
};

function ClassificationSavedRuleCard({
  appIcons,
  classificationRuleDeletingId,
  classificationRuleSegments,
  rule,
  t,
  onDeleteClassificationRule,
  onToggleClassificationRule,
}: ClassificationSavedRuleCardProps) {
  const detailKindLabel = localizedRuleDetailKindLabel(rule.detailKind, t);
  const detailLabel = rule.matchScope === "detail" && rule.detailValue ? `${detailKindLabel}: ${rule.detailValue}` : null;
  const surfaceLabel = `${localizedRuleSurfaceLabel(rule, t)}: ${rule.targetValue}`;
  const displayTitle = classificationRuleDisplayTitle(rule, classificationRuleSegments);
  const primaryLabel = displayTitle ?? surfaceLabel;
  const scopeLabel = localizedRuleScopeLabel(rule, t);
  const metadataLabel = `${scopeLabel} · ${displayTitle ? `${surfaceLabel} · ` : ""}${localizedCategoryLabel(rule.category, t)} · ${localizedProductivityLabel(rule.productivity, t)} · ${rule.enabled ? t("common.enabled") : t("common.disabled")}`;

  return (
    <article className="classification-rule-card" aria-label={t("settings.classification.ruleCardAria", { type: localizedRuleTargetLabel(rule.targetKind, t), value: displayTitle ?? rule.targetValue })}>
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
        <Toggle checked={rule.enabled} onChange={(enabled) => onToggleClassificationRule(rule, enabled)} ariaLabel={t(rule.enabled ? "settings.classification.disableRuleAria" : "settings.classification.enableRuleAria", { value: rule.targetValue })} />
        <button type="button" className="settings-btn danger classification-rule-card__delete" onClick={() => onDeleteClassificationRule(rule)} disabled={classificationRuleDeletingId === rule.id}>{classificationRuleDeletingId === rule.id ? t("settings.classification.deleting") : t("settings.classification.delete")}</button>
      </div>
    </article>
  );
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
