import type { AiSetupSection } from "./AiSetupSectionCards";
import {
  isManagedLocalAiRoute,
  normalizeOpenAiCompatibleBaseUrl,
  type LocalAiSetupState,
} from "./localAiSetup";

export function isActiveProviderTestable(setup: LocalAiSetupState): boolean {
  switch (setup.provider) {
    case "codex_cli":
    case "claude_cli":
      return true;
    case "openrouter_byok":
      return Boolean(setup.openRouterApiKey.trim());
    case "managed_local":
      if (!isManagedLocalAiRoute(setup)) return true;
      return Boolean(normalizeOpenAiCompatibleBaseUrl(setup.managedLocalBaseUrl) && setup.managedLocalModel.trim());
    case "openai":
      return Boolean(setup.openaiApiKey.trim() && setup.openaiModel.trim());
    case "anthropic":
      return Boolean(setup.anthropicApiKey.trim() && setup.anthropicModel.trim());
    case "self_hosted":
      return Boolean(normalizeOpenAiCompatibleBaseUrl(setup.selfHostedBaseUrl) && setup.selfHostedModel.trim());
    default:
      return assertNever(setup.provider);
  }
}

/** A model picked on a lock screen: Drifty Cloud or one of the keyed connections. */
export type ConnectionChoice = "cloud" | "openrouter" | "openai" | "anthropic" | "self_hosted";

/** The AI connection after a person picks a model on a lock screen; it serves every AI task. */
export function connectionForChoice(current: LocalAiSetupState, choice: ConnectionChoice): LocalAiSetupState {
  switch (choice) {
    case "cloud":
      return { ...current, provider: "managed_local", driftyRoute: "cloud" };
    case "openrouter":
      return { ...current, provider: "openrouter_byok" };
    case "self_hosted":
    case "openai":
    case "anthropic":
      return { ...current, provider: choice };
    default:
      return assertNever(choice);
  }
}

/** The setup card that holds the credentials for a keyed choice. */
export function setupCardForChoice(choice: Exclude<ConnectionChoice, "cloud">): Exclude<AiSetupSection, "drifty"> {
  switch (choice) {
    case "openrouter":
      return "openrouter";
    case "self_hosted":
      return "custom";
    case "openai":
    case "anthropic":
      return choice;
    default:
      return assertNever(choice);
  }
}

export function providerForSection(section: AiSetupSection): LocalAiSetupState["provider"] {
  switch (section) {
    case "codex_cli":
    case "claude_cli":
      return section;
    case "drifty":
      return "managed_local";
    case "openrouter":
      return "openrouter_byok";
    case "openai":
      return "openai";
    case "anthropic":
      return "anthropic";
    case "custom":
      return "self_hosted";
    default:
      return assertNever(section);
  }
}

export function sectionForProvider(provider: LocalAiSetupState["provider"]): AiSetupSection {
  switch (provider) {
    case "codex_cli":
    case "claude_cli":
      return provider;
    case "managed_local":
      return "drifty";
    case "openrouter_byok":
      return "openrouter";
    case "openai":
      return "openai";
    case "anthropic":
      return "anthropic";
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
