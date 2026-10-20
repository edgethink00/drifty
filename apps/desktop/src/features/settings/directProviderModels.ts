/**
 * Direct OpenAI and Anthropic connections. Kept free of other settings imports so
 * both the shared connection and the analysis overrides can use the same defaults.
 * Both tasks share one model per provider, so the defaults favour a small, cheap
 * model that handles frequent classification requests and project analysis.
 */
export const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_OPENAI_MODEL = "gpt-6-luna";
export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";
/** Evaluated models only; any other id can still be typed. */
export const OPENAI_MODEL_SUGGESTIONS = ["gpt-6-luna", "gpt-5-mini"] as const;
// Anthropic API aliases use dashes; the dotted form is OpenRouter's slug convention.
export const ANTHROPIC_MODEL_SUGGESTIONS = ["claude-haiku-5-5", "claude-sonnet-5"] as const;

export function normalizeDirectProviderModel(model: string, fallback: string): string {
  const trimmed = model.trim();
  return trimmed || fallback;
}
