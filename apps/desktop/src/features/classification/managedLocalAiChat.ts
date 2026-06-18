import { invoke } from "@tauri-apps/api/core";

import type { LocalAiProviderConfig } from "./localAiProviderRequest";
import {
  getManagedLocalAiStatus,
  startManagedLocalAi,
  type ManagedLocalAiStatus,
} from "../settings/managedLocalAiClient";

export type NativeOpenAiChatResponse = {
  readonly status?: unknown;
  readonly body?: unknown;
  readonly latencyMs?: unknown;
};

type ManagedLocalProviderConfig = Extract<LocalAiProviderConfig, { readonly provider: "managed_local" }>;

const READY_POLL_ATTEMPTS = 16;
const READY_POLL_INTERVAL_MS = 500;
const CONNECTION_ERROR_MARKERS = [
  "error sending request for url",
  "connection refused",
  "couldn't connect",
  "could not connect",
  "failed to connect",
  "tcp connect",
  "network error",
  "offline",
] as const;

export async function invokeOpenAiChatWithManagedLocalRetry(
  request: Record<string, unknown>,
  managedLocalProvider: ManagedLocalProviderConfig | null,
): Promise<NativeOpenAiChatResponse> {
  try {
    return await invoke<NativeOpenAiChatResponse>("ai_classification_openai_chat", { request });
  } catch (error) {
    if (!managedLocalProvider || !isLikelyManagedLocalConnectionError(error)) throw error;
    const readyStatus = await ensureManagedLocalAiReady(managedLocalProvider.modelId);
    return await invoke<NativeOpenAiChatResponse>("ai_classification_openai_chat", {
      request: requestWithManagedLocalRuntime(request, managedLocalProvider, readyStatus),
    });
  }
}

export function isLikelyManagedLocalConnectionError(error: unknown): boolean {
  const message = messageFromUnknownError(error).toLowerCase();
  return CONNECTION_ERROR_MARKERS.some((marker) => message.includes(marker));
}

async function ensureManagedLocalAiReady(modelId: string): Promise<ManagedLocalAiStatus> {
  const startedStatus = await startManagedLocalAi(modelId);
  const readyStartedStatus = readyManagedLocalStatus(startedStatus, modelId);
  if (readyStartedStatus) return readyStartedStatus;
  throwIfTerminalManagedLocalStatus(startedStatus);

  for (let attempt = 0; attempt < READY_POLL_ATTEMPTS; attempt += 1) {
    await sleep(READY_POLL_INTERVAL_MS);
    const status = await getManagedLocalAiStatus();
    const readyStatus = readyManagedLocalStatus(status, modelId);
    if (readyStatus) return readyStatus;
    throwIfTerminalManagedLocalStatus(status);
  }

  throw new ManagedLocalAiChatError("Managed local AI runtime did not become ready. Try again in a moment.");
}

function requestWithManagedLocalRuntime(
  request: Record<string, unknown>,
  provider: ManagedLocalProviderConfig,
  status: ManagedLocalAiStatus,
): Record<string, unknown> {
  const baseUrl = status.baseUrl ?? provider.baseUrl;
  const model = status.model ?? provider.model;
  if (!baseUrl || !model) throw new ManagedLocalAiChatError("Managed local AI runtime started without a usable endpoint.");
  return { ...request, baseUrl, model };
}

function readyManagedLocalStatus(status: ManagedLocalAiStatus, modelId: string): ManagedLocalAiStatus | null {
  if (status.selectedModelId !== modelId) return null;
  if (status.state !== "running") return null;
  if (!status.baseUrl || !status.model) return null;
  return status;
}

function throwIfTerminalManagedLocalStatus(status: ManagedLocalAiStatus): void {
  if (status.state === "error" || status.state === "not_installed" || status.state === "installing") {
    throw new ManagedLocalAiChatError(status.message || "Managed local AI runtime is not ready.");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function messageFromUnknownError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  return "";
}

class ManagedLocalAiChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagedLocalAiChatError";
  }
}
