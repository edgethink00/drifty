import type { CliSetupChoice } from "../onboarding/cliPilot";

/**
 * Models a subscription CLI classifies with, lightest first. Classification runs
 * in the background on the person's own plan, so the menu keeps to light models
 * that spend little of its usage limit. Chat already passes these full ids to
 * each CLI (Claude Code --model, Codex -m).
 */
export const CLI_CLASSIFICATION_MODELS: Readonly<Record<CliSetupChoice, readonly string[]>> = {
  claude_cli: ["claude-haiku-5-5", "claude-sonnet-5-5"],
  codex_cli: ["gpt-6-luna", "gpt-6.1-sol"],
};

export function isCliClassificationModel(choice: CliSetupChoice, model: unknown): model is string {
  return typeof model === "string" && CLI_CLASSIFICATION_MODELS[choice].includes(model);
}

/**
 * The model a subscription CLI runs. The provider keeps one model whichever way
 * it connects; one the CLI cannot run falls back to the lightest CLI model
 * without changing the saved choice.
 */
export function cliClassificationModel(
  choice: CliSetupChoice,
  setup: { readonly anthropicModel: string; readonly openaiModel: string },
): string {
  const saved = (choice === "claude_cli" ? setup.anthropicModel : setup.openaiModel).trim();
  return isCliClassificationModel(choice, saved) ? saved : CLI_CLASSIFICATION_MODELS[choice][0];
}

