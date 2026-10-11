import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from "react";
import { ClassificationPicker } from "./SettingsColorControls";
import { categoryControlColor, productivityControlColor, type AppThemeColorOverrides, type CategoryColorOverrides } from "./settingsStorage";
import {
  CATEGORY_ORDER,
  PRODUCTIVITY_ORDER,
  canonicalizeClassificationRuleSiteUrl,
  siteTargetFromCanonicalUrl,
  type ClassificationRuleInput,
  type ActivitySegment,
  type AppIconMap,
  type ClassificationRule,
} from "@drifty/domain";
import { AnchoredPresence } from "../../components/AnchoredPresence";
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
import { ActionLabel } from "../../components/ActionLabel";

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
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();
  const query = search.trim().toLocaleLowerCase();
  const visibleRules = classificationRules.filter((rule) => !query || classificationRuleSearchText(rule, classificationRuleSegments, t).includes(query));
  return (
    <div className="settings-block classification-rule-saved-block">
      <h3 id="classification-saved-rules-heading">{t("classification.rules.title")}</h3>
      {feedback}
      <section className="settings-row settings-row--group-start settings-row--group-end classification-rule-list-section" aria-labelledby="classification-saved-rules-heading">
        <div className="classification-rule-list-intro">
          <p className="classification-rules-manager__intro">
            {t("classification.rules.description")}{" "}
            <button type="button" className="classification-rules-manager__help-toggle" aria-expanded={helpOpen} aria-controls={helpId} onClick={() => setHelpOpen((open) => !open)}>{t("classification.rules.help")}</button>
          </p>
          <p id={helpId} className="classification-rules-manager__help" hidden={!helpOpen}>{t("settings.classification.savedRulesDescription")}</p>
        </div>
        <div className="classification-rule-list-head">
          <span className="classification-rule-list-count" role="status">{!hasError && !classificationRulesLoading ? t(query ? "classification.rules.count" : "classification.rules.totalCount", { count: visibleRules.length, total: classificationRules.length }) : null}</span>
          <div className="classification-rule-list-tools">
            {classificationRules.length > 8 || search ? <input type="search" className="settings-input" aria-label={t("classification.rules.search")} placeholder={t("classification.rules.search")} value={search} onChange={(event) => setSearch(event.target.value)} /> : null}
            {hasError ? <button type="button" className="settings-btn" onClick={onLoadClassificationRules} disabled={classificationRulesLoading}>{t("common.retry")}</button> : null}
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
            <div className="classification-rule-list" role="region" aria-label={t("settings.classification.savedRulesAria")}>
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [category, setCategory] = useState(rule.category);
  const [productivity, setProductivity] = useState(rule.productivity);
  const menuSlot = useRef<HTMLSpanElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const busy = saving || classificationRuleDeletingId !== null;
  const presentation = classificationRulePresentation(rule, classificationRuleSegments, t);
  const metadataLabel = [localizedCategoryLabel(rule.category, t), localizedProductivityLabel(rule.productivity, t), presentation.scopeLabel].join(" · ");
  const categoryDotStyle = { "--classification-rule-color": categoryControlColor(rule.category, categoryColorOverrides) } as CSSProperties;

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && menuSlot.current?.contains(event.target)) return;
      setMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuTrigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  // The chosen item disappears with its menu, so focus returns to the persistent trigger.
  const closeMenuToTrigger = () => {
    menuTrigger.current?.focus({ preventScroll: true });
    setMenuOpen(false);
  };

  return (
    <article className={`classification-rule-card${rule.enabled ? "" : " is-disabled"}`} aria-label={t("settings.classification.ruleCardAria", { type: presentation.scopeLabel, value: presentation.fullLabel })}>
      <div className="classification-rule-card__main">
        <span className="classification-rule-card__icon">
          {rule.targetKind === "site" ? <SiteFavicon domain={rule.targetValue} size={20} /> : <AppGlyph appName={presentation.name} iconSrc={classificationRuleAppIconSrc(rule, appIcons)} size="sm" />}
        </span>
        <div className="classification-rule-card__text">
          <p className="classification-rule-card__target" title={presentation.fullLabel}>
            <strong>{presentation.name}</strong>
            {presentation.detail ? <span className={`classification-rule-card__detail classification-rule-card__detail--${presentation.detailStyle}`}>{presentation.detail}</span> : null}
            {presentation.pageTitle ? <span className="classification-rule-card__page-title">{presentation.pageTitle}</span> : null}
          </p>
          <p className="classification-rule-card__meta">
            <span className="classification-rule-card__dot" style={categoryDotStyle} aria-hidden="true" />
            <span>{metadataLabel}</span>
          </p>
        </div>
      </div>
      <div className="classification-rule-card__actions">
        <Toggle disabled={busy} checked={rule.enabled} onChange={(enabled) => onToggleClassificationRule(rule, enabled)} ariaLabel={t(rule.enabled ? "settings.classification.disableRuleAria" : "settings.classification.enableRuleAria", { value: presentation.fullLabel })} />
        <span className="classification-rule-card__menu-slot" ref={menuSlot}>
          <button
            ref={menuTrigger}
            type="button"
            className="classification-rule-card__more"
            aria-label={t("classification.rules.optionsAria", { target: presentation.fullLabel })}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={busy}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.4" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="18.6" cy="12" r="1.7" /></svg>
          </button>
          <AnchoredPresence>{menuOpen ? (
            <div className="classification-rule-card__menu" role="menu" aria-label={t("classification.rules.options")}>
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  closeMenuToTrigger();
                  setCategory(rule.category);
                  setProductivity(rule.productivity);
                  setEditing(true);
                  setConfirmDelete(false);
                }}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11.2 2.8a1.4 1.4 0 0 1 2 2L5.5 12.5l-2.7.7.7-2.7 7.7-7.7Z" /></svg>
                {t("classification.rules.edit")}
              </button>
              <button
                type="button"
                role="menuitem"
                className="danger"
                disabled={busy}
                onClick={() => {
                  closeMenuToTrigger();
                  setConfirmDelete(true);
                  setEditing(false);
                }}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.1a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.1" /></svg>
                {t("settings.classification.delete")}
              </button>
            </div>
          ) : null}</AnchoredPresence>
        </span>
      </div>
      {editing ? (
        <form className="classification-rule-card__editor" onClick={revealOpenPicker} onKeyUp={revealOpenPicker} aria-label={t("classification.rules.editTarget", { target: presentation.fullLabel })} onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const saved = await onSaveRule({ targetKind: rule.targetKind, targetValue: rule.targetValue, matchScope: rule.matchScope, detailKind: rule.detailKind, detailValue: rule.detailValue, category, productivity, enabled: rule.enabled, confidence: rule.confidence });
          if (saved) setEditing(false);
        }}>
          <fieldset disabled={busy}>
            <ClassificationPicker label={t("settings.classification.category")} ariaLabel={t("settings.classification.category")} value={category} options={CATEGORY_ORDER} getLabel={(value) => localizedCategoryLabel(value, t)} getColor={(value) => categoryControlColor(value, categoryColorOverrides)} onChange={setCategory} />
            <ClassificationPicker label={t("settings.classification.productivity")} ariaLabel={t("settings.classification.productivity")} value={productivity} options={PRODUCTIVITY_ORDER} getLabel={(value) => localizedProductivityLabel(value, t)} getColor={(value) => productivityControlColor(value, appThemeColorOverrides)} onChange={setProductivity} variant="productivity" />
          </fieldset>
          <div className="classification-rule-card__form-actions">
            <button type="button" className="settings-btn" onClick={() => setEditing(false)} disabled={busy}>{t("common.cancel")}</button>
            <button type="submit" className="settings-btn settings-btn--primary" aria-label={t(busy ? "settings.classification.saving" : "classification.rules.save")} disabled={busy} aria-busy={busy}><ActionLabel busy={busy} busyLabel={t("settings.classification.saving")}>{t("common.save")}</ActionLabel></button>
          </div>
          <p>{t("classification.rules.editNotice")}</p>
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

type ClassificationRulePresentation = {
  /** Site domain or recorded app name; bundle IDs stay in the hover title. */
  readonly name: string;
  readonly detail: string | null;
  readonly detailStyle: "path" | "title";
  /** A readable page title recorded for an exact-page rule, when one is available. */
  readonly pageTitle: string | null;
  readonly scopeLabel: string;
  readonly fullLabel: string;
};

function classificationRulePresentation(rule: ClassificationRule, segments: readonly ActivitySegment[], t: LocalizationController["t"]): ClassificationRulePresentation {
  const scopeLabel = localizedRuleScopeLabel(rule, t);
  const detailValue = rule.matchScope === "detail" && rule.detailValue ? rule.detailValue : null;
  if (rule.targetKind === "app") {
    const appName = segments.find((segment) => segment.bundleId === rule.targetValue)?.appName?.trim() || null;
    const name = appName ?? rule.targetValue;
    const identity = appName && appName !== rule.targetValue ? `${appName} (${rule.targetValue})` : rule.targetValue;
    return { name, detail: detailValue, detailStyle: "title", pageTitle: null, scopeLabel, fullLabel: detailValue ? `${identity} · ${detailValue}` : identity };
  }
  if (detailValue && rule.detailKind === "siteUrl") {
    return {
      name: rule.targetValue,
      detail: siteRulePath(detailValue, rule.targetValue),
      detailStyle: "path",
      pageTitle: classificationRuleDisplayTitle(rule, segments),
      scopeLabel,
      fullLabel: detailValue,
    };
  }
  return { name: rule.targetValue, detail: detailValue, detailStyle: "title", pageTitle: null, scopeLabel, fullLabel: detailValue ? `${rule.targetValue} · ${detailValue}` : rule.targetValue };
}

function classificationRuleSearchText(rule: ClassificationRule, segments: readonly ActivitySegment[], t: LocalizationController["t"]): string {
  const presentation = classificationRulePresentation(rule, segments, t);
  return [rule.targetValue, rule.detailValue, presentation.name, presentation.pageTitle, presentation.scopeLabel, localizedCategoryLabel(rule.category, t), localizedProductivityLabel(rule.productivity, t)]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

/** Shows only the part of an exact-page URL that differs from the domain already on the row. */
function siteRulePath(url: string, targetValue: string): string {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}` || "/";
    return siteTargetFromCanonicalUrl(url) === targetValue ? path : `${parsed.host}${path}`;
  } catch {
    return url;
  }
}

function localizedRuleScopeLabel(rule: Pick<ClassificationRule, "matchScope" | "targetKind" | "detailKind">, t: LocalizationController["t"]): string {
  if (rule.matchScope === "detail") return localizedRuleDetailKindLabel(rule.detailKind, t);
  return rule.targetKind === "site" ? t("settings.classification.domain") : t("classification.rules.wholeApp");
}

function localizedRuleDetailKindLabel(detailKind: ClassificationRule["detailKind"], t: LocalizationController["t"]): string {
  switch (detailKind) {
    case "title": return t("settings.classification.title");
    case "windowTitle": return t("settings.classification.windowTitle");
    case "siteTitle": return t("settings.classification.pageTitle");
    case "youtubeTitle": return t("settings.classification.youtubeTitle");
    case "siteUrl": return t("settings.classification.exactUrl");
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
