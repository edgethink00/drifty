import type { LocalizationController } from "../localization/LocalizationContext";
import type { ManagedLocalAiModel } from "./managedLocalAiCatalog";
import { managedModelRuntimeMemoryLabel } from "./managedLocalAiMemory";

type Translate = LocalizationController["t"];

export function managedModelChoiceTitle(model: ManagedLocalAiModel, t: Translate): string {
  switch (model.tier) {
    case "economy": return t("ai.resources.modelLight");
    case "default": return t("ai.resources.modelBalanced");
    case "gemma": return t("ai.resources.modelGemma");
    case "smart": return t("ai.resources.modelLarge");
  }
}

/**
 * These are catalog estimates, never a claim about current memory pressure.
 * `fitInStatus` drops the fit verdict and the static memory recommendation for
 * a model whose status tag already says it cannot run here, so the two never compete.
 */
export function managedModelResourceDescription(
  model: ManagedLocalAiModel,
  t: Translate,
  { fitInStatus = false }: { readonly fitInStatus?: boolean } = {},
): string {
  const memory = managedModelRuntimeMemoryLabel(model, null);
  const blocked = fitInStatus && model.fit === "insufficient";
  return [
    blocked ? null
      : model.tier === "gemma" ? t("ai.resources.modelGemmaMemory")
        : model.tier === "smart" ? t("ai.resources.modelLargeMemory") : null,
    memory ? t("ai.resources.estimatedMemory", { memory }) : null,
    t("ai.resources.downloadSize", { size: model.downloadSize }),
    blocked ? null
      : model.fit === "insufficient" ? t("ai.resources.memoryInsufficient")
        : model.fit === "tight" ? t("ai.resources.memoryTight")
          : model.recommended ? t("ai.resources.memoryRecommendation") : null,
  ].filter(Boolean).join(" · ");
}
