import { invokeOpenAiChatWithManagedLocalRetry } from "./managedLocalAiChat";
import { toLocalSoulRefinementRequest, type LocalAiProviderConfig } from "./localAiProviderRequest";
import type { SuggestionCompletionRequest } from "./memorySuggestions";

/**
 * Sends one suggestion prompt to the user's local or bring-your-own provider and
 * returns the raw text. Returns null on any failure so a bad call only drops
 * that one candidate. Drifty Cloud uses memorySuggestionCloud.ts.
 */
export function createLocalSuggestionCompleter(
  provider: LocalAiProviderConfig,
  canSend: () => boolean = () => true,
): (request: SuggestionCompletionRequest) => Promise<string | null> {
  return async ({ prompt }) => {
    if (!canSend()) return null;
    const request = toLocalSoulRefinementRequest(provider, prompt);
    if (!request) return null;
    try {
      const response = await invokeOpenAiChatWithManagedLocalRetry(
        request.request,
        provider.provider === "managed_local" ? provider : null,
        canSend,
        { priority: "analysis" },
      );
      const status = typeof response.status === "number" ? response.status : 0;
      if (status < 200 || status >= 300 || typeof response.body !== "string") return null;
      const body: unknown = JSON.parse(response.body);
      return openAiMessageContent(body);
    } catch {
      return null;
    }
  };
}

function openAiMessageContent(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return null;
  const content = (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const text = content.flatMap((part: unknown) => {
    const value = typeof part === "object" && part !== null ? (part as { text?: unknown }).text : undefined;
    return typeof value === "string" ? [value] : [];
  }).join("\n");
  return text || null;
}
