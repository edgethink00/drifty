export type PreviewAiCommand = "ai_list_openai_models" | "ai_classification_openai_chat";

export const PREVIEW_AI_PROXY_PATH = "/__drifty_preview_ai";
export const PREVIEW_AI_MOCK_BASE_URL = "https://preview-ai.drifty.invalid/v1";
export const PREVIEW_AI_MOCK_MODELS = ["drifty-preview-fast", "drifty-preview-reasoning"] as const;

export function isPreviewAiMockBaseUrl(value: unknown): boolean {
  return typeof value === "string" && value.trim().replace(/\/+$/, "") === PREVIEW_AI_MOCK_BASE_URL;
}
