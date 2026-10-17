import { invoke } from "@tauri-apps/api/core";
import type { NativeOpenAiChatResponse } from "../classification/managedLocalAiChat";
import type { AiConnectionTestResult } from "./aiConnectionTest";

/** Uses the same native Anthropic transport as Intelligence, with synthetic content only. */
export async function testAnthropicConnection(input: { readonly apiKey: string; readonly model: string }): Promise<AiConnectionTestResult> {
  const apiKey = input.apiKey.trim(), model = input.model.trim();
  if (!apiKey || !model) return { kind: "error", issueKind: "provider", message: "Complete the selected provider settings before testing." };
  try {
    const response = await invoke<NativeOpenAiChatResponse>("ai_classification_anthropic_chat", {
      request: { apiKey, model, messages: [{ role: "user", content: 'Reply with compact JSON only: {"ok":true}' }], maxTokens: 64, timeoutMs: 30_000 },
    });
    const status = typeof response.status === "number" && Number.isFinite(response.status) ? response.status : 0;
    if (status < 200 || status >= 300) {
      return { kind: "error", issueKind: "provider", message: `Provider returned HTTP ${status}.` };
    }
    const body: unknown = JSON.parse(typeof response.body === "string" ? response.body : "");
    if (!isRecord(body) || !Array.isArray(body["content"]) || !body["content"].some(
      (block: unknown) => isRecord(block) && block["type"] === "text" && typeof block["text"] === "string" && block["text"].trim().length > 0,
    )) return { kind: "error", issueKind: "provider", message: "Provider responded, but no assistant message was returned." };
    const latency = typeof response.latencyMs === "number" && Number.isFinite(response.latencyMs) && response.latencyMs >= 0 ? response.latencyMs : 0;
    return { kind: "success", message: `Connected in ${latency} ms.` };
  } catch {
    return { kind: "error", issueKind: "provider", message: "Connection test failed." };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
