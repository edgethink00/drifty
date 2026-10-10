/**
 * Request-parameter support for models called through a direct provider API or
 * an OpenAI-compatible endpoint.
 *
 * OpenAI reasoning models (GPT-5 and later, o-series) and Claude 5-generation
 * models reject `temperature`; OpenAI reasoning models also reject `max_tokens`
 * and expect `max_completion_tokens`. OpenRouter silently drops unsupported
 * parameters unless `require_parameters` is set, but the vendors' own APIs
 * answer HTTP 400, so a direct-key project pass or a custom endpoint pointed at
 * api.openai.com would fail on every request. The checks key off the model id
 * so later generations (GPT-7, Claude 6) inherit the same handling.
 */

function bareModelId(model: string): string {
  const trimmed = model.trim().toLowerCase();
  return trimmed.includes("/") ? trimmed.slice(trimmed.lastIndexOf("/") + 1) : trimmed;
}

function generation(match: RegExpMatchArray | null): number | null {
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

/** OpenAI reasoning models: o1/o3/o4…, and GPT-5 or later. */
export function isOpenAiReasoningModel(model: string): boolean {
  const id = bareModelId(model);
  if (/^o\d/.test(id)) return true;
  const gpt = generation(id.match(/^gpt-(\d+)/));
  return gpt !== null && gpt >= 5;
}

/** Claude 5 generation or later ("claude-sonnet-5", "claude-haiku-5-5"); "claude-3-5-sonnet" is generation 3. */
export function isClaudeGenerationFiveOrLater(model: string): boolean {
  const claude = generation(bareModelId(model).match(/^claude-(?:[a-z]+-)?(\d+)/));
  return claude !== null && claude >= 5;
}

export function modelRejectsTemperature(model: string): boolean {
  return isOpenAiReasoningModel(model) || isClaudeGenerationFiveOrLater(model);
}

/** True when any model in a fallback list rejects temperature; the request is sent once for the whole list. */
export function anyModelRejectsTemperature(models: readonly string[]): boolean {
  return models.some(modelRejectsTemperature);
}

export function modelNeedsMaxCompletionTokens(model: string): boolean {
  return isOpenAiReasoningModel(model);
}

/**
 * Flags for the native `ai_classification_openai_chat` command. OpenRouter
 * accepts `max_tokens` for every model, so only non-OpenRouter endpoints rename it.
 */
export function openAiCompatibleParameterFlags(
  models: readonly string[],
  options: { readonly viaOpenRouter: boolean },
): { readonly omitTemperature?: true; readonly useMaxCompletionTokens?: true } {
  return {
    ...(anyModelRejectsTemperature(models) ? { omitTemperature: true as const } : {}),
    ...(!options.viaOpenRouter && models.some(modelNeedsMaxCompletionTokens) ? { useMaxCompletionTokens: true as const } : {}),
  };
}
