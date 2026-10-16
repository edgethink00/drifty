// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClassificationRule, ClassificationRuleInput } from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";
import type { LocalizationController } from "../localization/LocalizationContext";
import { useClassificationRulesController } from "./useClassificationRulesController";

afterEach(() => vi.restoreAllMocks());

describe("saved rule toggle identity", () => {
  it.each([
    ["::1", "http://::1:3000/work"],
    ["example.com", "https://example.com/work"],
  ])("disables %s without losing the stored rule ID or rewriting its URL", async (targetValue, detailValue) => {
    const rule: ClassificationRule = { id: "saved-rule", targetKind: "site", targetValue,
      matchScope: "detail", detailKind: "siteUrl", detailValue, category: "workspace",
      productivity: "focus", confidence: 1, enabled: true, createdAt: "2026-10-01", updatedAt: "2026-10-01" };
    const disabled = { ...rule, enabled: false };
    const save = vi.spyOn(trackerClient, "saveClassificationRule").mockResolvedValue(disabled);
    const apply = vi.spyOn(trackerClient, "applyClassificationRules").mockResolvedValue({ appliedCount: 0, matchedCount: 0, skippedCount: 0 });
    vi.spyOn(trackerClient, "getClassificationRules").mockResolvedValue([disabled]);
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useClassificationRulesController({ managerOpen: false,
      t: ((key: string) => key) as LocalizationController["t"], onRefreshSelectedDay: refresh }));
    await act(() => result.current.handleToggleClassificationRule(rule, false));
    expect(save).toHaveBeenCalledWith({ id: rule.id, targetKind: "site", targetValue, matchScope: "detail",
      detailKind: "siteUrl", detailValue, category: "workspace", productivity: "focus", confidence: 1, enabled: false });
    expect(apply).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    expect(result.current.classificationRules).toEqual([disabled]);
    expect(result.current.classificationRulesError).toBeNull();
  });
});


describe("rule target validation", () => {
  it("keeps empty-normalized site/app targets away from the tracker and permits a corrected save", async () => {
    const valid: ClassificationRuleInput = { targetKind: "site", targetValue: "example.com", category: "workspace", productivity: "focus", enabled: true };
    const saved: ClassificationRule = { ...valid, id: "valid-rule", matchScope: "surface", detailKind: null,
      detailValue: null, confidence: 1, enabled: true, createdAt: "2026-10-15", updatedAt: "2026-10-15" };
    const save = vi.spyOn(trackerClient, "saveClassificationRule").mockResolvedValue(saved);
    const apply = vi.spyOn(trackerClient, "applyClassificationRules").mockResolvedValue({ appliedCount: 0, matchedCount: 0, skippedCount: 0 });
    vi.spyOn(trackerClient, "getClassificationRules").mockResolvedValue([]);
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useClassificationRulesController({ managerOpen: false,
      t: ((key: string) => key) as LocalizationController["t"], onRefreshSelectedDay: refresh }));
    for (const invalid of [
      { ...valid, targetValue: "www.www.." },
      { ...valid, targetValue: "." },
      { ...valid, targetValue: "   " },
      { ...valid, targetKind: "app" as const, targetValue: " \t " },
    ]) {
      await act(async () => expect(await result.current.saveClassificationRule(invalid)).toBe(false));
      expect(result.current.classificationRulesError).toBe("classification.rules.addRowDescription");
      expect(result.current.classificationRuleSavingKind).toBeNull();
    }
    expect(save).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => expect(await result.current.saveClassificationRule(valid)).toBe(true));
    expect(save).toHaveBeenCalledExactlyOnceWith(valid);
    expect(apply).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    expect(result.current.classificationRulesError).toBeNull();
  });
});

describe("saved rule result", () => {
  const input: ClassificationRuleInput = { targetKind: "site", targetValue: "youtube.com", category: "learning", productivity: "focus", enabled: true };
  const saved: ClassificationRule = { ...input, id: "youtube", matchScope: "surface", detailKind: null, detailValue: null,
    confidence: 1, enabled: true, createdAt: "2026-10-16", updatedAt: "2026-10-16" };
  function setup() {
    vi.spyOn(trackerClient, "saveClassificationRule").mockImplementation(async (next) => ({ ...saved, enabled: next.enabled ?? true }));
    // Applying re-runs every enabled rule, so its totals include another rule's 6 records.
    vi.spyOn(trackerClient, "applyClassificationRules").mockResolvedValue({ matchedCount: 25, appliedCount: 24, skippedCount: 1 });
    vi.spyOn(trackerClient, "getClassificationRules").mockResolvedValue([saved]);
    const preview = vi.spyOn(trackerClient, "previewClassificationRule").mockResolvedValue({ matchedCount: 18, matchedSeconds: 21000, manualCount: 1 });
    const { result } = renderHook(() => useClassificationRulesController({ managerOpen: false,
      t: ((key: string) => key) as LocalizationController["t"], onRefreshSelectedDay: vi.fn().mockResolvedValue(undefined) }));
    return { preview, result };
  }

  it("reports the records the saved rule itself took, as its edit form counted them", async () => {
    const { preview, result } = setup();
    await act(async () => expect(await result.current.saveClassificationRule(input)).toBe(true));
    expect(preview).toHaveBeenCalledExactlyOnceWith(input);
    expect(result.current.classificationRuleApplyResult).toEqual({ matchedCount: 19, appliedCount: 18, skippedCount: 1 });
  });

  it("keeps the overall totals when the rule's own count is unavailable, and no count for a rule turned off", async () => {
    const { preview, result } = setup();
    preview.mockRejectedValueOnce(new Error("tracker unavailable"));
    await act(async () => expect(await result.current.saveClassificationRule(input)).toBe(true));
    expect(result.current.classificationRuleApplyResult).toEqual({ matchedCount: 25, appliedCount: 24, skippedCount: 1 });
    await act(() => result.current.handleToggleClassificationRule(saved, false));
    expect(result.current.classificationRuleApplyResult).toBeNull();
    expect(result.current.classificationRuleMessage).toBe("classification.rules.saved");
    expect(preview).toHaveBeenCalledOnce();
  });
});
