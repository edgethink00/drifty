import type { AiSetupSection } from "./AiSetupSectionCards";
import { isManagedLocalAiRoute, type LocalAiSetupState } from "./localAiSetup";

export function isActiveProviderTestable(setup: LocalAiSetupState): boolean {
  switch (setup.provider) {
    case "openrouter_byok":
      return Boolean(setup.openRouterApiKey.trim());
    case "managed_local":
      if (!isManagedLocalAiRoute(setup)) return true;
      return Boolean(setup.managedLocalBaseUrl.trim() && setup.managedLocalModel.trim());
    case "self_hosted":
      return Boolean(setup.selfHostedBaseUrl.trim() && setup.selfHostedModel.trim());
    default:
      return assertNever(setup.provider);
  }
}

export function providerForSection(section: AiSetupSection): LocalAiSetupState["provider"] {
  switch (section) {
    case "drifty":
      return "managed_local";
    case "openrouter":
      return "openrouter_byok";
    case "custom":
      return "self_hosted";
    default:
      return assertNever(section);
  }
}

export function sectionForProvider(provider: LocalAiSetupState["provider"]): AiSetupSection {
  switch (provider) {
    case "managed_local":
      return "drifty";
    case "openrouter_byok":
      return "openrouter";
    case "self_hosted":
      return "custom";
    default:
      return assertNever(provider);
  }
}

class AiSetupSectionError extends Error {
  constructor(readonly value: string) {
    super(`Unhandled AI setup value: ${value}`);
    this.name = "AiSetupSectionError";
  }
}

function assertNever(value: never): never {
  throw new AiSetupSectionError(String(value));
}
