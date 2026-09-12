import type { ManagedLocalAiModel } from "../settings/managedLocalAiCatalog";
import type { LOCAL_MODEL_FITS, MANAGED_MODEL_TIERS } from "../../lib/analytics/eventTaxonomy";

type LocalModelFit = (typeof LOCAL_MODEL_FITS)[number];
type ManagedModelTier = (typeof MANAGED_MODEL_TIERS)[number];

/**
 * A model whose fit is `insufficient` renders a disabled download button. When
 * every model in the catalog is insufficient the step cannot be completed at
 * all, because advancing requires a started download. An unknown fit is treated
 * as installable, matching the button state the user actually sees.
 */
export function hasInstallableLocalModel(catalog: readonly ManagedLocalAiModel[]): boolean {
  if (catalog.length === 0) return true;
  return catalog.some((model) => model.fit !== "insufficient");
}

/** True only after the catalog has loaded and every model is a dead end. */
export function isLocalModelUnsupported(
  catalog: readonly ManagedLocalAiModel[],
  loading: boolean,
): boolean {
  if (loading) return false;
  if (catalog.length === 0) return false;
  return !hasInstallableLocalModel(catalog);
}

export function shouldClearUnsupportedLocalChoice(
  step: string,
  setupChoice: string | null,
  catalog: readonly ManagedLocalAiModel[],
  loading: boolean,
): boolean {
  return step === "choose_setup"
    && setupChoice === "local_ai"
    && isLocalModelUnsupported(catalog, loading);
}

/** @deprecated Use hasInstallableLocalModel. Kept for existing analytics call sites. */
export const anyModelInstallable = hasInstallableLocalModel;

/** Fit of the model the catalog marks recommended, which is the default selection. */
export function recommendedModelFit(catalog: readonly ManagedLocalAiModel[]): LocalModelFit {
  const recommended = catalog.find((model) => model.recommended);
  return recommended?.fit ?? "unknown";
}

export function modelTier(catalog: readonly ManagedLocalAiModel[], modelId: string | null): ManagedModelTier {
  if (!modelId) return "unknown";
  return catalog.find((model) => model.id === modelId)?.tier ?? "unknown";
}
