import type { ManagedLocalAiModel } from "../settings/managedLocalAiClient";
import type { DisplayLanguage, LocalizationController } from "./LocalizationContext";

export function localizedManagedModelDetail(
  model: ManagedLocalAiModel,
  _language: DisplayLanguage,
  t: LocalizationController["t"],
): string {
  // Known-model copy is owned by translations in both languages; native catalog text is the fallback.
  switch (model.id) {
    case "drifty-qwen3-5-2b-economy": return t("settings.ai.modelDetailEconomy");
    case "drifty-qwen3-5-4b-default": return t("settings.ai.modelDetailDefault");
    case "drifty-gemma-4-12b-local": return t("settings.ai.modelDetailGemma");
    case "drifty-qwen3-6-27b-smart": return t("settings.ai.modelDetailSmart");
    default: return model.detail;
  }
}

export function localizedManagedModelFitDetail(
  model: ManagedLocalAiModel,
  language: DisplayLanguage,
  t: LocalizationController["t"],
): string {
  if (language === "en") return model.fitDetail ?? "";
  if (model.fit === "insufficient") return t("settings.ai.fitInsufficient");
  if (model.fit === "tight") return t("settings.ai.fitTight");
  return model.fitDetail ?? "";
}

export function localizedManagedModelTier(
  tier: ManagedLocalAiModel["tier"],
  language: DisplayLanguage,
  t: LocalizationController["t"],
): string {
  if (language === "en") return tier;
  switch (tier) {
    case "economy": return t("settings.ai.tierEconomy");
    case "default": return t("settings.ai.tierDefault");
    case "gemma": return t("settings.ai.tierGemma");
    case "smart": return t("settings.ai.tierSmart");
  }
}
