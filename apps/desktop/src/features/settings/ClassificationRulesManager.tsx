import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ActivitySegment,
  type AppIconMap,
  type ClassificationRule,
  type ClassificationRuleInput,
  type ClassificationRuleApplyResult,
  type ClassificationRuleTargetKind,
} from "@drifty/domain";
import { hasDuplicateClassificationRule } from "../classification/classificationViewData";
import type { AppThemeColorOverrides, CategoryColorOverrides } from "./settingsStorage";
import { ClassificationRuleComposer } from "./ClassificationRuleComposer";
import { ClassificationSavedRulesList } from "./ClassificationSavedRulesList";
import { useLocalization } from "../localization/LocalizationContext";
import { localizeSettingsError } from "../localization/settingsMessageTranslations";

/** How long a just-added rule stays marked in the list. */
const NEW_RULE_HIGHLIGHT_MS = 2600;

type ClassificationRulesManagerProps = {
  /** A heading outside the manager that names the saved rules (the rules sheet's title). */
  readonly headingId?: string;
  readonly onSaveRule: (input: ClassificationRuleInput) => Promise<boolean>;
  readonly appIcons: AppIconMap;
  readonly appThemeColorOverrides: AppThemeColorOverrides;
  readonly categoryColorOverrides: CategoryColorOverrides;
  readonly classificationRuleApplyResult: ClassificationRuleApplyResult | null;
  readonly classificationRuleDeletingId: string | null;
  readonly classificationRuleMessage: string | null;
  readonly classificationRuleSavingKind: ClassificationRuleTargetKind | null;
  readonly classificationRuleSegments: readonly ActivitySegment[];
  readonly classificationRules: ClassificationRule[];
  readonly classificationRulesError: string | null;
  readonly classificationRulesLoading: boolean;
  readonly onDeleteClassificationRule: (rule: ClassificationRule) => void;
  readonly onLoadClassificationRules: () => void;
  readonly onToggleClassificationRule: (rule: ClassificationRule, enabled: boolean) => void;
};

export function ClassificationRulesManager({
  headingId,
  onSaveRule,
  appIcons,
  appThemeColorOverrides,
  categoryColorOverrides,
  classificationRuleApplyResult,
  classificationRuleDeletingId,
  classificationRuleMessage,
  classificationRuleSavingKind,
  classificationRuleSegments,
  classificationRules,
  classificationRulesError,
  classificationRulesLoading,
  onDeleteClassificationRule,
  onLoadClassificationRules,
  onToggleClassificationRule,
}: ClassificationRulesManagerProps) {
  const { effectiveLanguage, t } = useLocalization();
  const [adding, setAdding] = useState(false);
  const [addedInput, setAddedInput] = useState<ClassificationRuleInput | null>(null);
  const addRowRef = useRef<HTMLButtonElement>(null);
  const saving = classificationRuleSavingKind !== null;

  const highlightRuleId = useMemo(() => {
    if (!addedInput) return null;
    return classificationRules.find((rule) => hasDuplicateClassificationRule([rule], addedInput.targetKind, addedInput.targetValue, addedInput))?.id ?? null;
  }, [addedInput, classificationRules]);

  useEffect(() => {
    if (!addedInput) return undefined;
    const timer = window.setTimeout(() => setAddedInput(null), NEW_RULE_HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [addedInput]);

  // Closing the form hands focus back to the row that opened it.
  const closeComposer = () => {
    setAdding(false);
    window.requestAnimationFrame(() => addRowRef.current?.focus({ preventScroll: true }));
  };

  return (
    <div data-setting-id="classification.rules.title" className="settings-section--classification classification-rules-manager">
      <ClassificationSavedRulesList
        headingId={headingId}
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
        saving={saving}
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
        highlightRuleId={highlightRuleId}
        addControl={(
          <div data-setting-id="classification.rules.add" className="classification-rule-add">
            {adding ? (
              <ClassificationRuleComposer
                classificationRules={classificationRules}
                appIcons={appIcons}
                appThemeColorOverrides={appThemeColorOverrides}
                categoryColorOverrides={categoryColorOverrides}
                saving={saving}
                onSaveRule={onSaveRule}
                onCancel={closeComposer}
                onSaved={(input) => {
                  setAddedInput(input);
                  closeComposer();
                }}
              />
            ) : (
              <button ref={addRowRef} type="button" className="classification-rule-add__row" onClick={() => setAdding(true)}>
                <span className="classification-rule-add__icon" aria-hidden="true">
                  <svg viewBox="0 0 16 16"><path d="M8 3.2v9.6M3.2 8h9.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                </span>
                <span>{t("classification.rules.addRow")}</span>
              </button>
            )}
          </div>
        )}
      />
    </div>
  );
}

function localizedApplyResult(result: ClassificationRuleApplyResult, t: ReturnType<typeof useLocalization>["t"]): string {
  // A new site or app with no history matches nothing yet; "0 updated, 0 unchanged" reads like a failure.
  if (result.matchedCount === 0) return t("classification.rules.applyNone");
  return t("classification.rules.applySummary", {
    matched: result.matchedCount,
    applied: result.appliedCount,
    skipped: result.skippedCount,
  });
}
