import type { LocalAiProviderConfig } from "../classification/localAiProviderRequest";
import {
  isManagedLocalAiRoute,
  normalizeOpenAiCompatibleBaseUrl,
  normalizeOpenRouterFallbackModels,
  normalizeOpenRouterPrimaryModel,
  type LocalAiSetupState,
} from "./localAiSetup";

export type LocalAiClassificationOptions = {
  readonly localProvider: LocalAiProviderConfig;
};

export function localAiProviderConfigFromSetup(setup: LocalAiSetupState): LocalAiClassificationOptions | null {
  switch (setup.provider) {
    case "managed_local": {
      if (!isManagedLocalAiRoute(setup)) return null;
      const baseUrl = normalizeOpenAiCompatibleBaseUrl(setup.managedLocalBaseUrl);
      const model = setup.managedLocalModel.trim();
      const modelId = setup.managedLocalModelId.trim();
      if (!baseUrl || !model || !modelId) return null;
      return { localProvider: { provider: "managed_local", baseUrl, model, modelId } };
    }
    case "openrouter_byok": {
      const apiKey = setup.openRouterApiKey.trim();
      if (!apiKey) return null;
      const model = normalizeOpenRouterPrimaryModel(setup.openRouterModel);
      const fallbackModels = normalizeOpenRouterFallbackModels(model, setup.openRouterFallbackModels);
      return { localProvider: { provider: "openrouter_byok", apiKey, model, fallbackModels } };
    }
    case "self_hosted": {
      const baseUrl = normalizeOpenAiCompatibleBaseUrl(setup.selfHostedBaseUrl);
      const apiKey = setup.selfHostedApiKey.trim();
      const model = setup.selfHostedModel.trim();
      if (!baseUrl || !model) return null;
      return { localProvider: { provider: "self_hosted", baseUrl, ...(apiKey ? { apiKey } : {}), model } };
    }
    default:
      return assertNever(setup.provider);
  }
}

class LocalAiClassificationOptionsError extends Error {
  constructor(readonly provider: string) {
    super(`Unhandled local AI provider: ${provider}`);
    this.name = "LocalAiClassificationOptionsError";
  }
}

function assertNever(value: never): never {
  throw new LocalAiClassificationOptionsError(String(value));
}
