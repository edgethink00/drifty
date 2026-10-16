import { describe, expect, it } from "vitest";
import { classificationRulePreviewInput, classificationRulePreviewKey } from "./classificationRulePreview";
import type { ClassificationCorrectionDraft } from "./classificationCorrection";

const draft: ClassificationCorrectionDraft = {
  scope: "surface",
  rowId: null,
  targetKind: "site",
  targetValue: "youtube.com",
  detailKind: null,
  detailValue: null,
  displayLabel: "youtube.com",
  category: "learning",
  productivity: "focus",
  originalCategory: "entertainment",
  originalProductivity: "drift",
};

describe("classificationRulePreview", () => {
  it("asks about the rule the correction would save, once per target and scope", () => {
    const input = classificationRulePreviewInput(draft);
    expect(input).toMatchObject({ targetKind: "site", targetValue: "youtube.com", matchScope: "surface", detailKind: null, detailValue: null });
    // A different pick asks nothing new: it does not change which records the rule takes.
    expect(classificationRulePreviewKey(classificationRulePreviewInput({ ...draft, category: "workspace", productivity: "neutral" })))
      .toBe(classificationRulePreviewKey(input));
    expect(classificationRulePreviewKey(classificationRulePreviewInput({ ...draft, scope: "detail", detailKind: "siteTitle", detailValue: "Lecture 4" })))
      .not.toBe(classificationRulePreviewKey(input));
  });

  it("asks nothing for records we could not name, which save no rule", () => {
    expect(classificationRulePreviewInput({ ...draft, scope: "records" })).toBeNull();
    expect(classificationRulePreviewKey(null)).toBeNull();
  });
});
