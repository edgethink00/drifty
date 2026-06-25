import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, FocusEvent, RefObject, SetStateAction } from "react";
import type {
  ActivityCategory,
  ClassificationRule,
  ClassificationRuleApplyResult,
  ClassificationRuleCandidate,
  ClassificationRuleInput,
  ClassificationRuleTargetKind,
  ProductivityLabel,
} from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";
import { toErrorMessage } from "../../lib/formatting";
import {
  classificationRuleTargetLabel,
  hasDuplicateClassificationRule,
  normalizeDomainRuleInput,
} from "./classificationViewData";

type UseClassificationRulesControllerInput = {
  readonly activeTab: string;
  readonly settingsSection: string;
  readonly onRefreshSelectedDay: () => Promise<unknown>;
};

type UseClassificationRulesControllerResult = {
  readonly appRuleCategory: ActivityCategory;
  readonly appRuleDisplayName: string;
  readonly appRuleProductivity: ProductivityLabel;
  readonly appRuleSearch: string;
  readonly appRuleSearchPanelOpen: boolean;
  readonly appRuleSearchRef: RefObject<HTMLDivElement>;
  readonly appRuleTargetValue: string;
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
  readonly handleAppRuleSearchBlur: (event: FocusEvent<HTMLDivElement>) => void;
  readonly handleAppRuleSearchFocus: () => void;
  readonly handleApplyClassificationRules: () => Promise<void>;
  readonly handleDeleteClassificationRule: (rule: ClassificationRule) => Promise<void>;
  readonly handleDomainRuleSearchBlur: (event: FocusEvent<HTMLDivElement>) => void;
  readonly handleDomainRuleSearchFocus: () => void;
  readonly handleSaveAppRule: () => Promise<void>;
  readonly handleSaveDomainRule: () => Promise<void>;
  readonly handleSelectClassificationCandidate: (candidate: ClassificationRuleCandidate) => void;
  readonly handleSelectDomainRuleCandidate: (candidate: ClassificationRuleCandidate) => void;
  readonly handleToggleClassificationRule: (rule: ClassificationRule, enabled: boolean) => Promise<void>;
  readonly loadClassificationRules: () => Promise<void>;
  readonly saveClassificationRule: (input: ClassificationRuleInput) => Promise<boolean>;
  readonly setAppRuleCategory: Dispatch<SetStateAction<ActivityCategory>>;
  readonly setAppRuleProductivity: Dispatch<SetStateAction<ProductivityLabel>>;
  readonly setDomainRuleCategory: Dispatch<SetStateAction<ActivityCategory>>;
  readonly setDomainRuleProductivity: Dispatch<SetStateAction<ProductivityLabel>>;
  readonly updateAppRuleSearch: (value: string) => void;
  readonly updateDomainRuleInput: (value: string) => void;
};

export function useClassificationRulesController({
  activeTab,
  settingsSection,
  onRefreshSelectedDay,
}: UseClassificationRulesControllerInput): UseClassificationRulesControllerResult {
  const [classificationRules, setClassificationRules] = useState<ClassificationRule[]>([]);
  const [classificationRulesLoading, setClassificationRulesLoading] = useState(false);
  const [classificationRulesError, setClassificationRulesError] = useState<string | null>(null);
  const [classificationRuleMessage, setClassificationRuleMessage] = useState<string | null>(null);
  const [classificationRuleSavingKind, setClassificationRuleSavingKind] = useState<ClassificationRuleTargetKind | null>(null);
  const [classificationRuleDeletingId, setClassificationRuleDeletingId] = useState<string | null>(null);
  const [classificationRuleApplying, setClassificationRuleApplying] = useState(false);
  const [classificationRuleApplyResult, setClassificationRuleApplyResult] = useState<ClassificationRuleApplyResult | null>(null);
  const [domainRuleInput, setDomainRuleInput] = useState("");
  const [domainRuleCandidates, setDomainRuleCandidates] = useState<ClassificationRuleCandidate[]>([]);
  const [domainRuleCandidatesLoading, setDomainRuleCandidatesLoading] = useState(false);
  const [domainRuleSearchPanelOpen, setDomainRuleSearchPanelOpen] = useState(false);
  const [domainRuleCategory, setDomainRuleCategory] = useState<ActivityCategory>("workspace");
  const [domainRuleProductivity, setDomainRuleProductivity] = useState<ProductivityLabel>("focus");
  const [appRuleSearch, setAppRuleSearch] = useState("");
  const [appRuleTargetValue, setAppRuleTargetValue] = useState("");
  const [appRuleDisplayName, setAppRuleDisplayName] = useState("");
  const [appRuleCategory, setAppRuleCategory] = useState<ActivityCategory>("workspace");
  const [appRuleProductivity, setAppRuleProductivity] = useState<ProductivityLabel>("focus");
  const [classificationRuleCandidates, setClassificationRuleCandidates] = useState<ClassificationRuleCandidate[]>([]);
  const [classificationRuleCandidatesLoading, setClassificationRuleCandidatesLoading] = useState(false);
  const [appRuleSearchPanelOpen, setAppRuleSearchPanelOpen] = useState(false);
  const domainRuleSearchRef = useRef<HTMLDivElement | null>(null);
  const appRuleSearchRef = useRef<HTMLDivElement | null>(null);

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
      const savedRule = await trackerClient.saveClassificationRule(input);
      const applyResult = await trackerClient.applyClassificationRules();
      setClassificationRuleApplyResult(applyResult);
      setClassificationRuleMessage(`${classificationRuleTargetLabel(savedRule.targetKind)} rule saved locally.`);
      setClassificationRules(await trackerClient.getClassificationRules());
      await onRefreshSelectedDay();
      return true;
    } catch (nextError) {
      setClassificationRulesError(toErrorMessage(nextError));
      return false;
    } finally {
      setClassificationRuleSavingKind(null);
    }
  }, [onRefreshSelectedDay]);

  const handleSaveDomainRule = useCallback(async () => {
    const targetValue = normalizeDomainRuleInput(domainRuleInput);
    if (!targetValue) {
      setClassificationRulesError("Enter a domain or URL, like example.com.");
      return;
    }
    if (hasDuplicateClassificationRule(classificationRules, "site", targetValue)) {
      setClassificationRulesError("A Domain rule for this site already exists. Edit or delete the existing rule first.");
      return;
    }
    const saved = await saveClassificationRule({ targetKind: "site", targetValue, category: domainRuleCategory, productivity: domainRuleProductivity, enabled: true });
    if (saved) {
      setDomainRuleInput("");
      setDomainRuleCandidates([]);
    }
  }, [classificationRules, domainRuleCategory, domainRuleInput, domainRuleProductivity, saveClassificationRule]);

  const handleSaveAppRule = useCallback(async () => {
    const targetValue = appRuleTargetValue.trim();
    if (!targetValue) {
      setClassificationRulesError("Search and choose a recorded app before saving an App rule.");
      return;
    }
    if (hasDuplicateClassificationRule(classificationRules, "app", targetValue)) {
      setClassificationRulesError("An App rule for this app already exists. Edit or delete the existing rule first.");
      return;
    }
    const saved = await saveClassificationRule({ targetKind: "app", targetValue, category: appRuleCategory, productivity: appRuleProductivity, enabled: true });
    if (saved) {
      setAppRuleSearch("");
      setAppRuleTargetValue("");
      setAppRuleDisplayName("");
      setClassificationRuleCandidates([]);
    }
  }, [appRuleCategory, appRuleProductivity, appRuleTargetValue, classificationRules, saveClassificationRule]);

  const handleToggleClassificationRule = useCallback(async (rule: ClassificationRule, enabled: boolean) => {
    await saveClassificationRule({
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
      setClassificationRuleMessage(`${classificationRuleTargetLabel(rule.targetKind)} rule deleted locally.`);
      setClassificationRules(await trackerClient.getClassificationRules());
      await onRefreshSelectedDay();
    } catch (nextError) {
      setClassificationRulesError(toErrorMessage(nextError));
    } finally {
      setClassificationRuleDeletingId(null);
    }
  }, [onRefreshSelectedDay]);

  const handleApplyClassificationRules = useCallback(async () => {
    setClassificationRuleApplying(true);
    setClassificationRulesError(null);
    setClassificationRuleMessage(null);
    try {
      const applyResult = await trackerClient.applyClassificationRules();
      setClassificationRuleApplyResult(applyResult);
      setClassificationRuleMessage("Local rules reapplied to matching activity.");
      await onRefreshSelectedDay();
    } catch (nextError) {
      setClassificationRulesError(toErrorMessage(nextError));
    } finally {
      setClassificationRuleApplying(false);
    }
  }, [onRefreshSelectedDay]);

  const handleSelectClassificationCandidate = useCallback((candidate: ClassificationRuleCandidate) => {
    setAppRuleSearch(candidate.displayName);
    setAppRuleDisplayName(candidate.displayName);
    setAppRuleTargetValue(candidate.targetValue);
    setAppRuleSearchPanelOpen(false);
    if (candidate.category) setAppRuleCategory(candidate.category);
    if (candidate.productivity) setAppRuleProductivity(candidate.productivity);
  }, []);

  const handleSelectDomainRuleCandidate = useCallback((candidate: ClassificationRuleCandidate) => {
    const targetValue = candidate.targetValue || candidate.siteDomain || candidate.displayName;
    setDomainRuleInput(targetValue);
    setDomainRuleSearchPanelOpen(false);
    if (candidate.category) setDomainRuleCategory(candidate.category);
    if (candidate.productivity) setDomainRuleProductivity(candidate.productivity);
  }, []);

  const scrollDomainRuleSearchIntoViewIfNeeded = useCallback(() => {
    const container = domainRuleSearchRef.current;
    if (!container || typeof container.scrollIntoView !== "function") return;
    const rect = container.getBoundingClientRect();
    if (rect.top >= 72 && rect.bottom + 320 <= window.innerHeight) return;
    container.scrollIntoView({ block: "center", inline: "nearest" });
  }, []);

  const scrollAppRuleSearchIntoViewIfNeeded = useCallback(() => {
    const container = appRuleSearchRef.current;
    if (!container || typeof container.scrollIntoView !== "function") return;
    const rect = container.getBoundingClientRect();
    if (rect.top >= 72 && rect.bottom + 320 <= window.innerHeight) return;
    container.scrollIntoView({ block: "center", inline: "nearest" });
  }, []);

  const handleDomainRuleSearchFocus = useCallback(() => {
    setDomainRuleSearchPanelOpen(true);
    window.requestAnimationFrame(scrollDomainRuleSearchIntoViewIfNeeded);
  }, [scrollDomainRuleSearchIntoViewIfNeeded]);

  const handleAppRuleSearchFocus = useCallback(() => {
    setAppRuleSearchPanelOpen(true);
    window.requestAnimationFrame(scrollAppRuleSearchIntoViewIfNeeded);
  }, [scrollAppRuleSearchIntoViewIfNeeded]);

  const handleDomainRuleSearchBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setDomainRuleSearchPanelOpen(false);
  }, []);

  const handleAppRuleSearchBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setAppRuleSearchPanelOpen(false);
  }, []);

  const updateAppRuleSearch = useCallback((value: string) => {
    setAppRuleSearch(value);
    setAppRuleTargetValue("");
    setAppRuleDisplayName("");
  }, []);

  const updateDomainRuleInput = useCallback((value: string) => {
    setDomainRuleInput(value);
  }, []);

  useEffect(() => {
    void loadClassificationRules();
  }, [loadClassificationRules]);

  useEffect(() => {
    if (activeTab !== "settings" || settingsSection !== "classification") return;
    void loadClassificationRules();
  }, [activeTab, loadClassificationRules, settingsSection]);

  useEffect(() => {
    if (activeTab !== "settings" || settingsSection !== "classification") return undefined;
    if (!domainRuleSearchPanelOpen) {
      setDomainRuleCandidatesLoading(false);
      return undefined;
    }
    const query = domainRuleInput.trim();

    let disposed = false;
    setDomainRuleCandidates([]);
    setDomainRuleCandidatesLoading(true);
    const timeoutId = window.setTimeout(() => {
      void trackerClient.searchClassificationRuleCandidates({ query, targetKind: "site" }).then((candidates) => {
        if (disposed) return;
        setDomainRuleCandidates(candidates.filter((candidate) => candidate.targetKind === "site"));
      }).catch((nextError) => {
        if (disposed) return;
        setClassificationRulesError(toErrorMessage(nextError));
        setDomainRuleCandidates([]);
      }).finally(() => {
        if (!disposed) setDomainRuleCandidatesLoading(false);
      });
    }, 180);

    return () => {
      disposed = true;
      window.clearTimeout(timeoutId);
    };
  }, [activeTab, domainRuleInput, domainRuleSearchPanelOpen, settingsSection]);

  useEffect(() => {
    if (activeTab !== "settings" || settingsSection !== "classification") return undefined;
    if (!appRuleSearchPanelOpen) {
      setClassificationRuleCandidatesLoading(false);
      return undefined;
    }
    const query = appRuleSearch.trim();

    let disposed = false;
    setClassificationRuleCandidates([]);
    setClassificationRuleCandidatesLoading(true);
    const timeoutId = window.setTimeout(() => {
      void trackerClient.searchClassificationRuleCandidates({ query, targetKind: "app" }).then((candidates) => {
        if (disposed) return;
        setClassificationRuleCandidates(candidates.filter((candidate) => candidate.targetKind === "app"));
      }).catch((nextError) => {
        if (disposed) return;
        setClassificationRulesError(toErrorMessage(nextError));
        setClassificationRuleCandidates([]);
      }).finally(() => {
        if (!disposed) setClassificationRuleCandidatesLoading(false);
      });
    }, 180);

    return () => {
      disposed = true;
      window.clearTimeout(timeoutId);
    };
  }, [activeTab, appRuleSearch, appRuleSearchPanelOpen, settingsSection]);

  useEffect(() => {
    if (!domainRuleSearchPanelOpen) return undefined;
    const frameId = window.requestAnimationFrame(scrollDomainRuleSearchIntoViewIfNeeded);
    return () => window.cancelAnimationFrame(frameId);
  }, [domainRuleCandidates.length, domainRuleCandidatesLoading, domainRuleSearchPanelOpen, scrollDomainRuleSearchIntoViewIfNeeded]);

  useEffect(() => {
    if (!appRuleSearchPanelOpen) return undefined;
    const frameId = window.requestAnimationFrame(scrollAppRuleSearchIntoViewIfNeeded);
    return () => window.cancelAnimationFrame(frameId);
  }, [appRuleSearchPanelOpen, classificationRuleCandidates.length, classificationRuleCandidatesLoading, scrollAppRuleSearchIntoViewIfNeeded]);

  return {
    appRuleCategory,
    appRuleDisplayName,
    appRuleProductivity,
    appRuleSearch,
    appRuleSearchPanelOpen,
    appRuleSearchRef,
    appRuleTargetValue,
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
    handleAppRuleSearchBlur,
    handleAppRuleSearchFocus,
    handleApplyClassificationRules,
    handleDeleteClassificationRule,
    handleDomainRuleSearchBlur,
    handleDomainRuleSearchFocus,
    handleSaveAppRule,
    handleSaveDomainRule,
    handleSelectClassificationCandidate,
    handleSelectDomainRuleCandidate,
    handleToggleClassificationRule,
    loadClassificationRules,
    saveClassificationRule,
    setAppRuleCategory,
    setAppRuleProductivity,
    setDomainRuleCategory,
    setDomainRuleProductivity,
    updateAppRuleSearch,
    updateDomainRuleInput,
  };
}
