import {
  canonicalizeClassificationRuleSiteUrl,
  type ActivitySegment,
  type AppIconMap,
  type ClassificationRule,
} from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { Toggle } from "../../components/Toggle";
import { categoryLabel, productivityLabel } from "../../lib/activityLabels";
import {
  classificationActivityLabel,
  classificationRuleAppIconSrc,
  classificationRuleDetailKindLabel,
  classificationRuleScopeLabel,
  classificationRuleSurfaceLabel,
  classificationRuleTargetLabel,
} from "../classification/classificationViewData";

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
  return (
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
          {classificationRules.map((rule) => (
            <ClassificationSavedRuleCard
              key={rule.id}
              appIcons={appIcons}
              classificationRuleDeletingId={classificationRuleDeletingId}
              classificationRuleSegments={classificationRuleSegments}
              rule={rule}
              onDeleteClassificationRule={onDeleteClassificationRule}
              onToggleClassificationRule={onToggleClassificationRule}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

type ClassificationSavedRuleCardProps = {
  readonly appIcons: AppIconMap;
  readonly classificationRuleDeletingId: string | null;
  readonly classificationRuleSegments: readonly ActivitySegment[];
  readonly rule: ClassificationRule;
  readonly onDeleteClassificationRule: (rule: ClassificationRule) => void;
  readonly onToggleClassificationRule: (rule: ClassificationRule, enabled: boolean) => void;
};

function ClassificationSavedRuleCard({
  appIcons,
  classificationRuleDeletingId,
  classificationRuleSegments,
  rule,
  onDeleteClassificationRule,
  onToggleClassificationRule,
}: ClassificationSavedRuleCardProps) {
  const detailKindLabel = classificationRuleDetailKindLabel(rule.detailKind);
  const detailLabel = rule.matchScope === "detail" && rule.detailValue ? `${detailKindLabel}: ${rule.detailValue}` : null;
  const surfaceLabel = `${classificationRuleSurfaceLabel(rule)}: ${rule.targetValue}`;
  const displayTitle = classificationRuleDisplayTitle(rule, classificationRuleSegments);
  const primaryLabel = displayTitle ?? surfaceLabel;
  const metadataLabel = `${classificationRuleScopeLabel(rule)} · ${displayTitle ? `${surfaceLabel} · ` : ""}${categoryLabel(rule.category)} · ${productivityLabel(rule.productivity)} · ${rule.enabled ? "Enabled" : "Disabled"}`;

  return (
    <article className="classification-rule-card" aria-label={`${classificationRuleTargetLabel(rule.targetKind)} rule ${displayTitle ?? rule.targetValue}`}>
      <div className="classification-rule-card__main">
        <span className="classification-rule-card__icon">
          {rule.targetKind === "site" ? <SiteFavicon domain={rule.targetValue} size={24} /> : <AppGlyph appName={rule.targetValue} iconSrc={classificationRuleAppIconSrc(rule, appIcons)} size="sm" />}
        </span>
        <span className="chip gray">{classificationRuleScopeLabel(rule)}</span>
        <div className="classification-rule-card__text">
          <strong title={primaryLabel}>{primaryLabel}</strong>
          <p>{metadataLabel}</p>
          {detailLabel ? <p className="classification-rule-card__detail">{detailLabel}</p> : null}
        </div>
      </div>
      <div className="classification-rule-card__actions">
        <Toggle checked={rule.enabled} onChange={(enabled) => onToggleClassificationRule(rule, enabled)} ariaLabel={`${rule.enabled ? "Disable" : "Enable"} ${rule.targetValue} rule`} />
        <button type="button" className="settings-btn danger" onClick={() => onDeleteClassificationRule(rule)} disabled={classificationRuleDeletingId === rule.id}>{classificationRuleDeletingId === rule.id ? "Deleting..." : "Delete"}</button>
      </div>
    </article>
  );
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
