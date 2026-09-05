import { invoke, isTauri } from "@tauri-apps/api/core";

import { PREVIEW_AI_PROXY_PATH, type PreviewAiCommand } from "./previewAiContract";

export async function invokePreviewAwareAiCommand<T>(
  command: PreviewAiCommand,
  args: { readonly request: Record<string, unknown> },
): Promise<T> {
  if (!shouldUsePreviewAiProxy()) return invoke<T>(command, args);

  const response = await globalThis.fetch(PREVIEW_AI_PROXY_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, request: args.request }),
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(errorMessage(responseText, response.status));

  try {
    return JSON.parse(responseText) as T;
  } catch {
    throw new Error("The development preview returned an invalid AI proxy response.");
  }
}

export function shouldUsePreviewAiProxy(
  isDevelopment = import.meta.env.DEV,
  previewFlag = import.meta.env.VITE_DRIFTY_PREVIEW,
  tauriRuntime = isDevelopment && previewFlag === "1" ? isTauri() : false,
): boolean {
  return isDevelopment && previewFlag === "1" && !tauriRuntime;
}

function errorMessage(body: string, status: number): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (isRecord(parsed) && typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();
  } catch {
    // Fall through to the status-based message.
  }
  return `The development preview AI proxy returned HTTP ${status}.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
