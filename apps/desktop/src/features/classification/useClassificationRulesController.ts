import { useCallback, useEffect, useState } from "react";
import type {
  ClassificationRule,
  ClassificationRuleApplyResult,
  ClassificationRuleInput,
  ClassificationRuleTargetKind,
} from "@drifty/domain";
import type { LocalizationController } from "../localization/LocalizationContext";
import { trackerClient } from "../../lib/api/trackerClient";
import { toErrorMessage } from "../../lib/formatting";
import { normalizeClassificationRuleTarget } from "./classificationViewData";

type UseClassificationRulesControllerInput = {
  readonly managerOpen: boolean;
  readonly t: LocalizationController["t"];
  readonly onRefreshSelectedDay: () => Promise<unknown>;
};

type UseClassificationRulesControllerResult = {
  readonly classificationRuleApplyResult: ClassificationRuleApplyResult | null;
  readonly classificationRuleDeletingId: string | null;
  readonly classificationRuleMessage: string | null;
  readonly classificationRuleSavingKind: ClassificationRuleTargetKind | null;
  readonly classificationRules: ClassificationRule[];
  readonly classificationRulesError: string | null;
  readonly classificationRulesLoading: boolean;
  readonly handleDeleteClassificationRule: (rule: ClassificationRule) => Promise<void>;
  readonly handleToggleClassificationRule: (rule: ClassificationRule, enabled: boolean) => Promise<void>;
  readonly loadClassificationRules: () => Promise<void>;
  readonly saveClassificationRule: (input: ClassificationRuleInput) => Promise<boolean>;
};

export function useClassificationRulesController({
  managerOpen,
  t,
  onRefreshSelectedDay,
}: UseClassificationRulesControllerInput): UseClassificationRulesControllerResult {
  const [classificationRules, setClassificationRules] = useState<ClassificationRule[]>([]);
  const [classificationRulesLoading, setClassificationRulesLoading] = useState(false);
  const [classificationRulesError, setClassificationRulesError] = useState<string | null>(null);
  const [classificationRuleMessage, setClassificationRuleMessage] = useState<string | null>(null);
  const [classificationRuleSavingKind, setClassificationRuleSavingKind] = useState<ClassificationRuleTargetKind | null>(null);
  const [classificationRuleDeletingId, setClassificationRuleDeletingId] = useState<string | null>(null);
  const [classificationRuleApplyResult, setClassificationRuleApplyResult] = useState<ClassificationRuleApplyResult | null>(null);

  const loadClassificationRules = useCallback(async () => {
    setClassificationRulesLoading(true);
    setClassificationRulesError(null);
    try {
      setClassificationRules(await trackerClient.getClassificationRules());
    } catch (nextError) {
      setClassificationRulesError(toErrorMessage(nextError));
    } finally {
      setClassificationRulesLoading(false);
    }
  }, []);

  const saveClassificationRule = useCallback(async (input: ClassificationRuleInput) => {
    setClassificationRuleSavingKind(input.targetKind);
    setClassificationRulesError(null);
    setClassificationRuleMessage(null);
    setClassificationRuleApplyResult(null);
    try {
      if (!normalizeClassificationRuleTarget(input.targetKind, input.targetValue)) {
        throw new Error(t("classification.rules.addRowDescription"));
      }
      const saved = await trackerClient.saveClassificationRule(input);
      if (!saved) throw new Error("The classification could not be saved. Try again.");
      const applyResult = await trackerClient.applyClassificationRules();
      setClassificationRuleApplyResult(applyResult);
      setClassificationRuleMessage(t("classification.rules.saved"));
      setClassificationRules(await trackerClient.getClassificationRules());
      await onRefreshSelectedDay();
      return true;
    } catch (nextError) {
      setClassificationRulesError(toErrorMessage(nextError));
      return false;
    } finally {
      setClassificationRuleSavingKind(null);
    }
  }, [onRefreshSelectedDay, t]);

  const handleToggleClassificationRule = useCallback(async (rule: ClassificationRule, enabled: boolean) => {
    await saveClassificationRule({
      id: rule.id,
      targetKind: rule.targetKind,
      targetValue: rule.targetValue,
      matchScope: rule.matchScope,
      detailKind: rule.detailKind ?? null,
      detailValue: rule.detailValue ?? null,
      category: rule.category,
      productivity: rule.productivity,
      enabled,
      confidence: rule.confidence ?? null,
    });
  }, [saveClassificationRule]);

  const handleDeleteClassificationRule = useCallback(async (rule: ClassificationRule) => {
    setClassificationRuleDeletingId(rule.id);
    setClassificationRulesError(null);
    setClassificationRuleMessage(null);
    setClassificationRuleApplyResult(null);
    try {
      await trackerClient.deleteClassificationRule(rule.id);
      setClassificationRuleMessage(t("classification.rules.removed"));
      setClassificationRules(await trackerClient.getClassificationRules());
      await onRefreshSelectedDay();
    } catch (nextError) {
      setClassificationRulesError(toErrorMessage(nextError));
    } finally {
      setClassificationRuleDeletingId(null);
    }
  }, [onRefreshSelectedDay, t]);

  useEffect(() => {
    void loadClassificationRules();
  }, [loadClassificationRules]);

  useEffect(() => {
    if (!managerOpen) return;
    void loadClassificationRules();
  }, [loadClassificationRules, managerOpen]);

  return {
    classificationRuleApplyResult,
    classificationRuleDeletingId,
    classificationRuleMessage,
    classificationRuleSavingKind,
    classificationRules,
    classificationRulesError,
    classificationRulesLoading,
    handleDeleteClassificationRule,
    handleToggleClassificationRule,
    loadClassificationRules,
    saveClassificationRule,
  };
}
