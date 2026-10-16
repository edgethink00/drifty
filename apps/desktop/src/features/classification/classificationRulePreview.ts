import type { ClassificationRuleInput } from "@drifty/domain";
import type { ClassificationCorrectionDraft } from "./classificationCorrection";

/**
 * The rule a correction would save, for asking how many past records it
 * applies to before saving it. Category and productivity do not change which
 * records a rule takes, so this is asked once per target and scope. Records we
 * could not name save no rule and already state their count.
 */
export function classificationRulePreviewInput(draft: ClassificationCorrectionDraft): ClassificationRuleInput | null {
  if (draft.scope === "records") return null;
  return {
    targetKind: draft.targetKind,
    targetValue: draft.targetValue,
    matchScope: draft.scope,
    detailKind: draft.scope === "detail" ? draft.detailKind : null,
    detailValue: draft.scope === "detail" ? draft.detailValue : null,
    category: draft.category,
    productivity: draft.productivity,
    enabled: true,
    confidence: 1,
  };
}

export function classificationRulePreviewKey(input: ClassificationRuleInput | null): string | null {
  if (!input) return null;
  return [input.targetKind, input.targetValue, input.matchScope, input.detailKind ?? "", input.detailValue ?? ""].join("\u0000");
}
