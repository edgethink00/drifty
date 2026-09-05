import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

import {
  isPreviewAiMockBaseUrl,
  PREVIEW_AI_MOCK_MODELS,
  PREVIEW_AI_PROXY_PATH,
  type PreviewAiCommand,
} from "./src/features/settings/previewAiContract";

const DEFAULT_CHAT_TIMEOUT_MS = 60_000;
const DEFAULT_MODEL_LIST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_BYTES = 1_000_000;
const MAX_UPSTREAM_RESPONSE_BYTES = 5_000_000;
const MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60;
type PreviewAiRequest = {
  readonly command: PreviewAiCommand;
  readonly request: Record<string, unknown>;
};

export function previewAiProxyPlugin(enabled: boolean): Plugin {
  return {
    name: "drifty-preview-ai-proxy",
    configureServer(server) {
      if (!enabled) return;
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?", 1)[0] !== PREVIEW_AI_PROXY_PATH) {
          next();
          return;
        }
        void handlePreviewAiRequest(request, response).catch((error: unknown) => {
          writeJson(response, 502, { error: messageFromUnknown(error) });
        });
      });
    },
  };
}

async function handlePreviewAiRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "POST") {
    writeJson(response, 405, { error: "The development preview AI proxy accepts POST requests only." });
    return;
  }
  if (!isSameOriginRequest(request)) {
    writeJson(response, 403, { error: "Cross-origin preview AI proxy requests are not allowed." });
    return;
  }
  if (!String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    writeJson(response, 415, { error: "The development preview AI proxy requires JSON." });
    return;
  }

  const payload = parsePreviewAiRequest(await readRequestBody(request));
  const result = payload.command === "ai_list_openai_models"
    ? await listModels(payload.request)
    : await postChat(payload.request);
  writeJson(response, 200, result);
}

async function listModels(request: Record<string, unknown>): Promise<Record<string, unknown>> {
  const baseUrl = normalizedBaseUrl(request.baseUrl);
  if (isPreviewAiMockBaseUrl(baseUrl)) {
    return {
      status: 200,
      body: JSON.stringify({ data: PREVIEW_AI_MOCK_MODELS.map((id) => ({ id })) }),
    };
  }
  const headers = authorizationHeaders(request.apiKey);
  const upstream = await fetchWithTimeout(`${baseUrl}/models`, { headers }, DEFAULT_MODEL_LIST_TIMEOUT_MS);
  return { status: upstream.status, body: await readUpstreamBody(upstream) };
}

async function postChat(request: Record<string, unknown>): Promise<Record<string, unknown>> {
  const baseUrl = normalizedBaseUrl(request.baseUrl);
  const models = normalizedModels(request.model, request.models);
  if (models.length === 0) throw new Error("AI provider model is required.");
  const messages = requiredArray(request.messages, "AI provider messages are required.");
  if (isPreviewAiMockBaseUrl(baseUrl)) {
    return {
      status: 200,
      body: JSON.stringify({
        choices: [{ message: { role: "assistant", content: JSON.stringify({ ok: true }) } }],
      }),
      latencyMs: 0,
      retryAfterMs: null,
      previewMock: true,
    };
  }
  const headers = new Headers({
    "Content-Type": "application/json",
    ...authorizationHeaders(request.apiKey),
  });
  appendSafeHeaders(headers, request.headers);

  const body: Record<string, unknown> = {
    messages,
    temperature: finiteNumberOrDefault(request.temperature, 0.1),
    stream: false,
    ...(models.length === 1 ? { model: models[0] } : { models }),
  };
  copyPositiveNumber(body, "max_tokens", request.maxTokens);
  copyDefined(body, "response_format", request.responseFormat);
  copyNonEmptyString(body, "reasoning_format", request.reasoningFormat);
  copyNonEmptyRecord(body, "chat_template_kwargs", request.chatTemplateKwargs);
  copyNonEmptyRecord(body, "provider", request.provider);

  const startedAt = performance.now();
  const timeoutMs = positiveNumberOrDefault(request.timeoutMs, DEFAULT_CHAT_TIMEOUT_MS);
  const upstream = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }, timeoutMs);
  const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
  return {
    status: upstream.status,
    body: await readUpstreamBody(upstream),
    latencyMs,
    retryAfterMs: retryAfterMs(upstream.headers.get("retry-after")),
  };
}

function parsePreviewAiRequest(body: string): PreviewAiRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("The development preview AI proxy received invalid JSON.");
  }
  if (!isRecord(parsed) || !isRecord(parsed.request)) throw new Error("The development preview AI proxy request is incomplete.");
  if (parsed.command !== "ai_list_openai_models" && parsed.command !== "ai_classification_openai_chat") {
    throw new Error("The requested AI preview command is not allowed.");
  }
  return { command: parsed.command, request: parsed.request };
}

function normalizedBaseUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("AI provider base URL is required.");
  const normalized = value.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("AI provider base URL is invalid.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("AI provider base URL must use HTTP or HTTPS.");
  return normalized;
}

function normalizedModels(model: unknown, models: unknown): string[] {
  const candidates = Array.isArray(models) ? models : [model];
  return [...new Set(candidates.flatMap((value) => typeof value === "string" && value.trim() ? [value.trim()] : []))];
}

function authorizationHeaders(value: unknown): Record<string, string> {
  return typeof value === "string" && value.trim() ? { Authorization: `Bearer ${value.trim()}` } : {};
}

function appendSafeHeaders(headers: Headers, value: unknown): void {
  if (!isRecord(value)) return;
  const forbidden = new Set(["connection", "content-length", "host", "transfer-encoding"]);
  for (const [name, candidate] of Object.entries(value)) {
    if (forbidden.has(name.toLowerCase())) continue;
    if (typeof candidate === "string" && candidate.trim()) headers.set(name, candidate.trim());
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`AI provider request timed out after ${Math.round(timeoutMs)} ms.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function positiveNumberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteNumberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function requiredArray(value: unknown, message: string): readonly unknown[] {
  if (Array.isArray(value)) return value;
  throw new Error(message);
}

function copyPositiveNumber(target: Record<string, unknown>, key: string, value: unknown): void {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) target[key] = value;
}

function copyDefined(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null) target[key] = value;
}

function copyNonEmptyString(target: Record<string, unknown>, key: string, value: unknown): void {
  if (typeof value === "string" && value.trim()) target[key] = value.trim();
}

function copyNonEmptyRecord(target: Record<string, unknown>, key: string, value: unknown): void {
  if (isRecord(value) && Object.keys(value).length > 0) target[key] = value;
}

function retryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 0) return null;
  return Math.min(seconds, MAX_RETRY_AFTER_SECONDS) * 1_000;
}

function isSameOriginRequest(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function readUpstreamBody(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_UPSTREAM_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("AI provider response exceeded the development preview limit.");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("The development preview AI proxy request is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function writeJson(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  if (response.headersSent || response.writableEnded) return;
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  return "The development preview AI proxy request failed.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
