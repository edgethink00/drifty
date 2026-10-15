import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useDeletedCategories } from "./categoryCustomizationStore";
import {
  CATEGORY_ORDER,
  PRODUCTIVITY_ORDER,
  canonicalizeClassificationRuleSiteUrl,
  secondsToLabel,
  siteTargetFromCanonicalUrl,
  type ActivityCategory,
  type AppIconMap,
  type ClassificationRule,
  type ClassificationRuleCandidate,
  type ClassificationRuleInput,
  type ProductivityLabel,
} from "@drifty/domain";
import { ActionLabel } from "../../components/ActionLabel";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { trackerClient } from "../../lib/api/trackerClient";
import {
  classificationRuleCandidateAppIconSrc,
  hasDuplicateClassificationRule,
  normalizeDomainRuleInput,
} from "../classification/classificationViewData";
import { localizedCategoryLabel, localizedProductivityLabel } from "../localization/activityTranslations";
import { useLocalization } from "../localization/LocalizationContext";
import { ClassificationPicker } from "./SettingsColorControls";
import { categoryControlColor, productivityControlColor, type AppThemeColorOverrides, type CategoryColorOverrides } from "./settingsStorage";

const VISIBLE_OPTIONS = 6;

type Translate = ReturnType<typeof useLocalization>["t"];

type ComposerTarget = {
  readonly kind: "app" | "site";
  readonly value: string;
  readonly name: string;
  readonly candidate: ClassificationRuleCandidate | null;
  /** Canonical page URL when the typed address had a path; offers "This page only". */
  readonly pageUrl: string | null;
};

type ComposerOption = {
  readonly key: string;
  readonly target: ComposerTarget;
  readonly label: string;
  readonly taken: boolean;
};

type ClassificationRuleComposerProps = {
  readonly classificationRules: readonly ClassificationRule[];
  readonly appIcons: AppIconMap;
  readonly appThemeColorOverrides: AppThemeColorOverrides;
  readonly categoryColorOverrides: CategoryColorOverrides;
  readonly saving: boolean;
  readonly onSaveRule: (input: ClassificationRuleInput) => Promise<boolean>;
  readonly onCancel: () => void;
  readonly onSaved: (input: ClassificationRuleInput) => void;
};

/**
 * Adds one ongoing classification: search recorded apps and sites together
 * (most used first) or type an address, then pick the category and focus.
 */
export function ClassificationRuleComposer({
  classificationRules,
  appIcons,
  appThemeColorOverrides,
  categoryColorOverrides,
  saving,
  onSaveRule,
  onCancel,
  onSaved,
}: ClassificationRuleComposerProps) {
  const deletedCategories = useDeletedCategories();
  const { t } = useLocalization();
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<ComposerTarget | null>(null);
  const [scope, setScope] = useState<"site" | "page">("site");
  const [category, setCategory] = useState<ActivityCategory>("workspace");
  const [productivity, setProductivity] = useState<ProductivityLabel>("focus");
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldsRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const optionsId = useId();

  const typed = typedAddress(query);
  const search = useRuleCandidates(typed.searchQuery, target === null);
  const options = composerOptions(search.candidates, typed, classificationRules, t);
  const input = target ? ruleInput(target, scope, category, productivity) : null;
  const duplicate = input ? hasDuplicateClassificationRule([...classificationRules], input.targetKind, input.targetValue, input) : false;

  useEffect(() => {
    if (target) fieldsRef.current?.querySelector<HTMLElement>("button, select")?.focus({ preventScroll: true });
    else inputRef.current?.focus({ preventScroll: true });
  }, [target]);

  // The form opens at the bottom of the page; keep it, and the matches once they arrive, in view.
  useEffect(() => {
    rootRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [target, search.loading]);

  const choose = (next: ComposerTarget) => {
    setTarget(next);
    setScope("site");
    setCategory(next.candidate?.category ?? "workspace");
    setProductivity(next.candidate?.productivity ?? "focus");
  };

  const save = async () => {
    if (!input || duplicate || saving) return;
    if (await onSaveRule(input)) onSaved(input);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    // A search field clears itself on Escape; here Escape closes the whole form instead.
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  };

  const kindLabel = (target: ComposerTarget) => t(target.kind === "app" ? "classification.composer.kindApp" : "classification.composer.kindSite");

  return (
    <div ref={rootRef} className="classification-rule-composer" onKeyDown={handleKeyDown}>
      {target && input ? (
        <>
          <div className="classification-rule-composer__target">
            <span className="classification-rule-composer__icon"><TargetIcon target={target} appIcons={appIcons} /></span>
            <span className="classification-rule-composer__name">{target.name}</span>
            <span className="classification-rule-composer__kind">{kindLabel(target)}</span>
            <button type="button" className="classification-rule-composer__change" aria-label={t("classification.composer.changeAria")} disabled={saving} onClick={() => setTarget(null)}>
              {t("classification.composer.change")}
            </button>
          </div>
          <div ref={fieldsRef} className="classification-rule-composer__fields">
            {target.pageUrl ? (
              <div className="classification-rule-field classification-rule-composer__scope">
                <span>{t("classification.rules.scopeLabel")}</span>
                <div className="settings-mode-switch settings-mode-switch--compact" role="radiogroup" aria-label={t("classification.rules.scopeLabel")}>
                  <button type="button" role="radio" aria-checked={scope === "site"} className={"settings-mode-option" + (scope === "site" ? " is-active" : "")} onClick={() => setScope("site")}>
                    <span>{t("settings.classification.domain")}</span>
                  </button>
                  <button type="button" role="radio" aria-checked={scope === "page"} className={"settings-mode-option" + (scope === "page" ? " is-active" : "")} onClick={() => setScope("page")}>
                    <span>{t("settings.classification.exactUrl")}</span>
                  </button>
                </div>
              </div>
            ) : null}
            <ClassificationPicker label={t("settings.classification.category")} ariaLabel={t("settings.classification.category")} value={category} options={CATEGORY_ORDER.filter((value) => !deletedCategories.has(value) || value === category)} getLabel={(value) => localizedCategoryLabel(value, t)} getColor={(value) => categoryControlColor(value, categoryColorOverrides)} onChange={setCategory} />
            <ClassificationPicker label={t("settings.classification.productivity")} ariaLabel={t("settings.classification.productivity")} value={productivity} options={PRODUCTIVITY_ORDER} getLabel={(value) => localizedProductivityLabel(value, t)} getColor={(value) => productivityControlColor(value, appThemeColorOverrides)} onChange={setProductivity} variant="productivity" />
            <div className="classification-rule-composer__actions">
              <button type="button" className="settings-btn" disabled={saving} onClick={onCancel}>{t("common.cancel")}</button>
              <button type="button" className="settings-btn settings-btn--primary" aria-label={t("classification.composer.saveAria", { target: input.detailValue ?? target.name })} disabled={saving || duplicate} aria-busy={saving} onClick={() => void save()}>
                <ActionLabel busy={saving} busyLabel={t("settings.classification.saving")}>{t("common.save")}</ActionLabel>
              </button>
            </div>
          </div>
          {scope === "page" && input.detailValue ? <p className="classification-rule-composer__note">{t("settings.classification.exactUrlSelected", { url: input.detailValue })}</p> : null}
          {duplicate ? <p className="classification-rule-composer__note classification-rule-composer__note--warn" role="status">{t("classification.composer.duplicate")}</p> : null}
        </>
      ) : (
        <>
          <div className="classification-rule-composer__search">
            <svg className="classification-rule-composer__search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            <input
              ref={inputRef}
              type="search"
              className="settings-input"
              value={query}
              placeholder={t("classification.composer.placeholder")}
              aria-label={t("classification.composer.searchAria")}
              aria-controls={optionsId}
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                const first = options.find((option) => !option.taken);
                if (first) choose(first.target);
              }}
            />
            <button type="button" className="settings-btn" onClick={onCancel}>{t("common.cancel")}</button>
          </div>
          <div id={optionsId} className="classification-rule-composer__options" role="group" aria-label={t("classification.composer.candidatesAria")} aria-busy={search.loading}>
            {options.map((option) => (
              <button
                key={option.key}
                type="button"
                className="classification-rule-composer__option"
                disabled={option.taken}
                aria-label={option.target.candidate ? t("settings.classification.chooseCandidateAria", { name: option.label, usage: candidateUsageLabel(option.target.candidate, t) }) : option.label}
                onClick={() => choose(option.target)}
              >
                <span className="classification-rule-composer__icon"><TargetIcon target={option.target} appIcons={appIcons} /></span>
                <span className="classification-rule-composer__name">{option.label}</span>
                <span className="classification-rule-composer__kind">{option.taken ? t("classification.composer.taken") : kindLabel(option.target)}</span>
                <span className="classification-rule-composer__usage">{option.target.candidate ? secondsToLabel(option.target.candidate.totalSeconds) : ""}</span>
              </button>
            ))}
            {options.length === 0 ? (
              <p className="classification-rule-composer__hint" role="status">
                {t(search.loading ? "classification.composer.loading" : search.failed ? "classification.composer.loadFailed" : "classification.composer.noMatch")}
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function TargetIcon({ target, appIcons }: { readonly target: ComposerTarget; readonly appIcons: AppIconMap }) {
  if (target.kind === "site") return <SiteFavicon domain={target.value} size={20} />;
  const iconSrc = target.candidate ? classificationRuleCandidateAppIconSrc(target.candidate, appIcons) : null;
  return <AppGlyph appName={target.candidate?.appName ?? target.name} iconSrc={iconSrc} size="sm" />;
}

type TypedAddress = {
  /** Site the typed address names, or null when it is not an address. */
  readonly domain: string | null;
  readonly pageUrl: string | null;
  /** Searching "github.com/org/repo" should still find github.com. */
  readonly searchQuery: string;
};

function typedAddress(query: string): TypedAddress {
  const trimmed = query.trim();
  const canonical = trimmed.includes(".") ? canonicalizeClassificationRuleSiteUrl(trimmed) : null;
  const domain = canonical ? normalizeDomainRuleInput(trimmed) : "";
  if (!canonical || !domain.includes(".")) return { domain: null, pageUrl: null, searchQuery: trimmed };
  return { domain, pageUrl: hasPath(canonical) ? canonical : null, searchQuery: /[/:]/.test(trimmed) ? domain : trimmed };
}

function hasPath(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname !== "/" || parsed.search !== "";
  } catch {
    return false;
  }
}

function composerOptions(candidates: readonly ClassificationRuleCandidate[], typed: TypedAddress, rules: readonly ClassificationRule[], t: Translate): ComposerOption[] {
  // A page rule can sit beside a whole-site rule, so only whole targets read as taken.
  const isTaken = (target: ComposerTarget) => !target.pageUrl && hasDuplicateClassificationRule([...rules], target.kind, target.value);
  const option = (target: ComposerTarget, label: string): ComposerOption => ({ key: target.kind + ":" + target.value, target, label, taken: isTaken(target) });
  const typedCandidate = typed.domain ? candidates.find((candidate) => candidate.targetKind === "site" && candidate.targetValue === typed.domain) : undefined;
  const options: ComposerOption[] = [];
  if (typed.domain && !typedCandidate) {
    options.push(option({ kind: "site", value: typed.domain, name: typed.domain, candidate: null, pageUrl: typed.pageUrl }, t("classification.composer.useAddress", { domain: typed.domain })));
  }
  for (const candidate of candidates) {
    if (options.length >= VISIBLE_OPTIONS) break;
    options.push(option({
      kind: candidate.targetKind === "app" ? "app" : "site",
      value: candidate.targetValue,
      name: candidate.displayName,
      candidate,
      pageUrl: candidate === typedCandidate ? typed.pageUrl : null,
    }, candidate.displayName));
  }
  return options;
}

function ruleInput(target: ComposerTarget, scope: "site" | "page", category: ActivityCategory, productivity: ProductivityLabel): ClassificationRuleInput {
  if (target.kind === "site" && scope === "page" && target.pageUrl) {
    return {
      targetKind: "site",
      targetValue: siteTargetFromCanonicalUrl(target.pageUrl) ?? target.value,
      matchScope: "detail",
      detailKind: "siteUrl",
      detailValue: target.pageUrl,
      category,
      productivity,
      enabled: true,
    };
  }
  return { targetKind: target.kind, targetValue: target.value, category, productivity, enabled: true };
}

function candidateUsageLabel(candidate: ClassificationRuleCandidate, t: Translate): string {
  return t(candidate.segmentCount === 1 ? "settings.classification.candidateUsageSingle" : "settings.classification.candidateUsage", {
    duration: secondsToLabel(candidate.totalSeconds),
    count: candidate.segmentCount,
  });
}

/** Recorded sites and apps for one query, merged and ordered by time used. */
function useRuleCandidates(query: string, enabled: boolean) {
  const [state, setState] = useState<{ readonly candidates: ClassificationRuleCandidate[]; readonly loading: boolean; readonly failed: boolean }>({ candidates: [], loading: true, failed: false });
  useEffect(() => {
    if (!enabled) return undefined;
    let disposed = false;
    setState((current) => ({ ...current, loading: true, failed: false }));
    const timer = window.setTimeout(() => {
      void Promise.all([
        trackerClient.searchClassificationRuleCandidates({ query, targetKind: "site" }),
        trackerClient.searchClassificationRuleCandidates({ query, targetKind: "app" }),
      ]).then(([sites, apps]) => {
        if (disposed) return;
        const candidates = [...sites.filter((candidate) => candidate.targetKind === "site"), ...apps.filter((candidate) => candidate.targetKind === "app")]
          .sort((a, b) => b.totalSeconds - a.totalSeconds);
        setState({ candidates, loading: false, failed: false });
      }).catch(() => {
        if (!disposed) setState({ candidates: [], loading: false, failed: true });
      });
    }, 160);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [enabled, query]);
  return state;
}
