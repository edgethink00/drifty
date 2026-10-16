import { analysisUnavailableReasonFromHttp } from "../settings/intelligenceRouting";
import { parseProjectPassOutput, type ProjectPassInferenceResult, type ProjectPassOutput } from "./aiProjectReviewService";
import type { NativeOpenAiChatResponse } from "./managedLocalAiChat";

const PROJECT_PASS_REPAIR_RESPONSE_CHAR_LIMIT = 24_000;
const PROJECT_PASS_REPAIR_INSTRUCTION =
  'The previous response was not valid JSON. Return only a valid JSON object with top-level arrays "assignments" and "corrections". Do not include markdown, code fences, comments, or explanations.';

type ChatShape = "openai" | "anthropic";
type ChatProvider = "openrouter" | "openai" | "anthropic" | "self_hosted" | "cloud";

interface ChatUsage {
  readonly model: string | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
}

interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface ProjectPassChatDispatchOptions {
  readonly request: Record<string, unknown>;
  readonly fallbackModel: string;
  readonly provider: ChatProvider;
  readonly shape: ChatShape;
  readonly throwHttpError?: (status: number, detail: string) => Error;
}

interface RepairOptions extends ProjectPassChatDispatchOptions {
  readonly malformedContent: string;
  readonly firstUsage: ChatUsage;
  readonly firstLatencyMs: number | null;
}

/** Parses one analysis answer; a null result triggers a single JSON repair turn. */
export interface AnalysisChatProtocol<T> {
  readonly parse: (content: string) => T | null;
  readonly repairInstruction: string;
}

export type AnalysisChatResult<T> = Omit<ProjectPassInferenceResult, "output"> & { readonly output: T | null };

const PROJECT_PASS_PROTOCOL: AnalysisChatProtocol<ProjectPassOutput> = {
  parse: (content) => parseProjectPassOutput(content),
  repairInstruction: PROJECT_PASS_REPAIR_INSTRUCTION,
};

export async function dispatchProjectPassChat(
  invokeChat: (request: Record<string, unknown>) => Promise<NativeOpenAiChatResponse>,
  options: ProjectPassChatDispatchOptions,
): Promise<ProjectPassInferenceResult> {
  return dispatchAnalysisChat(invokeChat, options, PROJECT_PASS_PROTOCOL);
}

export async function dispatchAnalysisChat<T>(
  invokeChat: (request: Record<string, unknown>) => Promise<NativeOpenAiChatResponse>,
  options: ProjectPassChatDispatchOptions,
  protocol: AnalysisChatProtocol<T>,
): Promise<AnalysisChatResult<T>> {
  const response = await invokeChat(options.request);
  const status = responseStatus(response);
  const latencyMs = responseLatency(response);
  if (status < 200 || status >= 300) return httpFailure(options, response, latencyMs);

  const parsed = parseNativeBody(response.body);
  const usage = usageForShape(options.shape, parsed, options.fallbackModel);
  const content = contentForShape(options.shape, parsed);
  const output = protocol.parse(content);
  if (output) return { output, usage: usagePayload(options.provider, usage, latencyMs) };

  return (
    (await repairAnalysisChat(invokeChat, {
      ...options,
      malformedContent: content,
      firstUsage: usage,
      firstLatencyMs: latencyMs,
    }, protocol)) ?? { output: null, usage: usagePayload(options.provider, usage, latencyMs) }
  );
}

function parseNativeBody(body: unknown): Record<string, unknown> {
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return isRecord(parsed) ? parsed : {};
    } catch (error) {
      if (error instanceof SyntaxError) return {};
      throw error;
    }
  }
  return isRecord(body) ? body : {};
}

function httpFailure(options: ProjectPassChatDispatchOptions, response: NativeOpenAiChatResponse, latencyMs: number | null): AnalysisChatResult<never> {
  const status = responseStatus(response);
  const detail = typeof response.body === "string" ? response.body.slice(0, 300) : "";
  if (options.throwHttpError) throw options.throwHttpError(status, detail);
  console.warn(`[project-pass] ${options.provider} analysis model HTTP ${status}: ${detail}`);
  const unavailableReason = analysisUnavailableReasonFromHttp(status, response.body);
  return { output: null, usage: { provider: options.provider, latencyMs }, ...(unavailableReason ? { unavailableReason } : {}) };
}

async function repairAnalysisChat<T>(
  invokeChat: (request: Record<string, unknown>) => Promise<NativeOpenAiChatResponse>,
  options: RepairOptions,
  protocol: AnalysisChatProtocol<T>,
): Promise<AnalysisChatResult<T> | null> {
  const repairRequest = buildRepairRequest(options.request, options.malformedContent, protocol.repairInstruction);
  if (!repairRequest) return null;

  const response = await invokeChat(repairRequest);
  const status = responseStatus(response);
  const latencyMs = addNullableNumbers(options.firstLatencyMs, responseLatency(response));
  if (status < 200 || status >= 300) {
    const detail = typeof response.body === "string" ? response.body.slice(0, 300) : "";
    console.warn(`[project-pass] ${options.provider} JSON repair HTTP ${status}: ${detail}`);
    return { output: null, usage: usagePayload(options.provider, options.firstUsage, latencyMs) };
  }

  const parsed = parseNativeBody(response.body);
  const repairUsage = usageForShape(options.shape, parsed, options.fallbackModel);
  return {
    output: protocol.parse(contentForShape(options.shape, parsed)),
    usage: usagePayload(options.provider, mergeChatUsage(options.firstUsage, repairUsage), latencyMs),
  };
}

function buildRepairRequest(request: Record<string, unknown>, malformedContent: string, repairInstruction: string): Record<string, unknown> | null {
  if (!malformedContent.trim()) return null;
  const messages = requestMessages(request);
  if (!messages) return null;
  return {
    ...request,
    messages: [...messages, { role: "assistant", content: trimRepairContent(malformedContent) }, { role: "user", content: repairInstruction }],
  };
}

function requestMessages(request: Record<string, unknown>): ChatMessage[] | null {
  const messages = request.messages;
  if (!Array.isArray(messages)) return null;
  const parsed: ChatMessage[] = [];
  for (const message of messages) {
    if (!isRecord(message) || !isChatRole(message.role) || typeof message.content !== "string") return null;
    parsed.push({ role: message.role, content: message.content });
  }
  return parsed;
}

function contentForShape(shape: ChatShape, record: Record<string, unknown>): string {
  switch (shape) {
    case "openai":
      return openAiContentFromParsedBody(record);
    case "anthropic":
      return anthropicContentFromParsedBody(record);
    default:
      return assertNever(shape);
  }
}

function usageForShape(shape: ChatShape, record: Record<string, unknown>, fallbackModel: string): ChatUsage {
  switch (shape) {
    case "openai":
      return openAiUsageFromParsedBody(record, fallbackModel);
    case "anthropic":
      return anthropicUsageFromParsedBody(record, fallbackModel);
    default:
      return assertNever(shape);
  }
}

function openAiContentFromParsedBody(record: Record<string, unknown>): string {
  const choices = record.choices;
  if (!Array.isArray(choices)) return "";
  const firstChoice = choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) return "";
  const content = firstChoice.message.content;
  return typeof content === "string" ? content : "";
}

function anthropicContentFromParsedBody(record: Record<string, unknown>): string {
  const content = record.content;
  if (!Array.isArray(content)) return "";
  const firstContent = content[0];
  if (!isRecord(firstContent)) return "";
  const text = firstContent.text;
  return typeof text === "string" ? text : "";
}

function openAiUsageFromParsedBody(record: Record<string, unknown>, fallbackModel: string): ChatUsage {
  const usage = isRecord(record.usage) ? record.usage : {};
  return {
    model: typeof record.model === "string" ? record.model : fallbackModel,
    tokensIn: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
    tokensOut: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
  };
}

function anthropicUsageFromParsedBody(record: Record<string, unknown>, fallbackModel: string): ChatUsage {
  const usage = isRecord(record.usage) ? record.usage : {};
  return {
    model: typeof record.model === "string" ? record.model : fallbackModel,
    tokensIn: typeof usage.input_tokens === "number" ? usage.input_tokens : null,
    tokensOut: typeof usage.output_tokens === "number" ? usage.output_tokens : null,
  };
}

function usagePayload(provider: ChatProvider, usage: ChatUsage, latencyMs: number | null): ProjectPassInferenceResult["usage"] {
  return { model: usage.model, provider, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, latencyMs };
}

function mergeChatUsage(first: ChatUsage, second: ChatUsage): ChatUsage {
  return {
    model: second.model ?? first.model,
    tokensIn: addNullableNumbers(first.tokensIn, second.tokensIn),
    tokensOut: addNullableNumbers(first.tokensOut, second.tokensOut),
  };
}

function addNullableNumbers(left: number | null, right: number | null): number | null {
  if (left === null && right === null) return null;
  return (left ?? 0) + (right ?? 0);
}

function responseStatus(response: NativeOpenAiChatResponse): number {
  return typeof response.status === "number" ? response.status : 0;
}

function responseLatency(response: NativeOpenAiChatResponse): number | null {
  return typeof response.latencyMs === "number" ? response.latencyMs : null;
}

function trimRepairContent(content: string): string {
  if (content.length <= PROJECT_PASS_REPAIR_RESPONSE_CHAR_LIMIT) return content;
  return `${content.slice(0, PROJECT_PASS_REPAIR_RESPONSE_CHAR_LIMIT)}\n...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChatRole(value: unknown): value is ChatMessage["role"] {
  return value === "system" || value === "user" || value === "assistant";
}

function assertNever(value: never): never {
  throw new Error(`Unsupported project pass chat shape: ${String(value)}`);
}
