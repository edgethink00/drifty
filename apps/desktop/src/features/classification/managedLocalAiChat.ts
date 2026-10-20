import { managedLocalAiQueue } from "./managedLocalAiQueue";
import { invoke } from "@tauri-apps/api/core";

import type { LocalAiProviderConfig } from "./localAiProviderRequest";
import { invokePreviewAwareAiCommand } from "../settings/previewAiBridge";
import { invokeAnthropicNativeChat, isAnthropicWireRequest } from "./anthropicChat";
import {
  getManagedLocalAiStatus,
  startManagedLocalAi,
  type ManagedLocalAiStatus,
} from "../settings/managedLocalAiClient";

export type NativeOpenAiChatResponse = {
  readonly status?: unknown;
  readonly body?: unknown;
  readonly latencyMs?: unknown;
  readonly retryAfterMs?: unknown;
  readonly previewMock?: unknown;
};

type ManagedLocalProviderConfig = Extract<LocalAiProviderConfig, { readonly provider: "managed_local" }>;

const READY_POLL_INTERVAL_MS = 500;
// Rust owns the runtime's two-minute cold-start deadline. Keep the renderer
// willing to wait for that full lifecycle so larger managed models and slower
// machines are not reported as disconnected after the old eight-second window.
export const MANAGED_LOCAL_AI_READY_TIMEOUT_MS = 120_000;
const READY_POLL_ATTEMPTS = Math.ceil(MANAGED_LOCAL_AI_READY_TIMEOUT_MS / READY_POLL_INTERVAL_MS);
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
  canSend: () => boolean = () => true,
  options: { readonly priority?: "classification" | "analysis"; readonly invokeChat?: (request: Record<string, unknown>) => Promise<NativeOpenAiChatResponse> } = {},
): Promise<NativeOpenAiChatResponse> {
  const send = () => sendOpenAiChatWithManagedLocalRetry(request, managedLocalProvider, canSend, options.invokeChat);
  return managedLocalProvider ? managedLocalAiQueue.run(options.priority ?? "classification", canSend, send) : send();
}

async function sendOpenAiChatWithManagedLocalRetry(
  request: Record<string, unknown>, managedLocalProvider: ManagedLocalProviderConfig | null, canSend: () => boolean,
  chat: (request: Record<string, unknown>) => Promise<NativeOpenAiChatResponse> = request => isAnthropicWireRequest(request)
      ? invokeAnthropicNativeChat(request)
      : invokePreviewAwareAiCommand("ai_classification_openai_chat", { request }),
): Promise<NativeOpenAiChatResponse> {
  const checkCanSend = () => {
    if (!canSend()) throw new ManagedLocalAiChatError("AI request cancelled before sending.");
  };
  checkCanSend();
  const readyRequest = managedLocalProvider
    ? await requestForReadyManagedLocalRuntime(request, managedLocalProvider, checkCanSend)
    : request;
  const sentAt = Date.now();
  try {
    checkCanSend();
    return await chat(readyRequest);
  } catch (error) {
    if (!managedLocalProvider || !isLikelyManagedLocalConnectionError(error)) throw error;
    checkCanSend();
    const status = await getManagedLocalAiStatus();
    checkCanSend();
    if (readyManagedLocalStatus(status, managedLocalProvider.modelId)) {
      // An alive runtime can have consumed the entire generation budget. Never
      // repeat an ambiguous long request as if its connection had not started.
      const timeout = typeof readyRequest.timeoutMs === "number" ? readyRequest.timeoutMs : 60_000;
      if (Date.now() - sentAt >= timeout - 1000) throw new ManagedLocalAiChatTimeoutError();
      throw error;
    }
    const readyStatus = await ensureManagedLocalAiReady(managedLocalProvider.modelId, checkCanSend);
    checkCanSend();
    return await chat(requestWithManagedLocalRuntime(request, managedLocalProvider, readyStatus));
  }
}

export function isLikelyManagedLocalConnectionError(error: unknown): boolean {
  const message = messageFromUnknownError(error).toLowerCase();
  return CONNECTION_ERROR_MARKERS.some((marker) => message.includes(marker));
}

async function requestForReadyManagedLocalRuntime(
  request: Record<string, unknown>,
  provider: ManagedLocalProviderConfig,
  check: () => void,
): Promise<Record<string, unknown>> {
  const status = await getManagedLocalAiStatus();
  check();
  const readyStatus = readyManagedLocalStatus(status, provider.modelId);
  if (readyStatus) return requestWithManagedLocalRuntime(request, provider, readyStatus);

  const startedStatus = await ensureManagedLocalAiReady(provider.modelId, check);
  return requestWithManagedLocalRuntime(request, provider, startedStatus);
}

export async function ensureManagedLocalAiReady(modelId: string, check: () => void = () => {}): Promise<ManagedLocalAiStatus> {
  check();
  const startedStatus = await startManagedLocalAi(modelId);
  check();
  const readyStartedStatus = readyManagedLocalStatus(startedStatus, modelId);
  if (readyStartedStatus) return readyStartedStatus;
  throwIfTerminalManagedLocalStatus(startedStatus);

  for (let attempt = 0; attempt < READY_POLL_ATTEMPTS; attempt += 1) {
    await sleep(READY_POLL_INTERVAL_MS);
    check();
    const status = await getManagedLocalAiStatus();
    check();
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

export class ManagedLocalAiChatTimeoutError extends Error {
  constructor() { super("Local AI request timed out. Try a smaller input."); this.name = "ManagedLocalAiChatTimeoutError"; }
}
