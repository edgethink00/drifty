import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ANTHROPIC_WIRE_FORMAT,
  anthropicResponseAsOpenAiChat,
  anthropicWireRequest,
  invokeAnthropicNativeChat,
  isAnthropicWireRequest,
} from "./anthropicChat";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const messageBody = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  id: "msg_1",
  model: "claude-haiku-5-5",
  content: [{ type: "text", text: "{\"ok\":" }, { type: "tool_use", id: "x" }, { type: "text", text: "true}" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 12, output_tokens: 5 },
  ...overrides,
});

describe("anthropicWireRequest", () => {
  beforeEach(() => invokeMock.mockReset());

  it("moves system messages to a top-level field and keeps the other turns", () => {
    const request = anthropicWireRequest({
      apiKey: "sk-ant-test",
      model: "claude-3-5-haiku-latest",
      messages: [
        { role: "system", content: "Rubric" },
        { role: "user", content: "Items" },
        { role: "system", content: "More rules" },
      ],
      maxTokens: 2_048,
    });
    expect(request).toMatchObject({
      wireFormat: ANTHROPIC_WIRE_FORMAT,
      apiKey: "sk-ant-test",
      model: "claude-3-5-haiku-latest",
      system: "Rubric\n\nMore rules",
      messages: [{ role: "user", content: "Items" }],
      maxTokens: 2_048,
      temperature: 0,
    });
    expect(isAnthropicWireRequest(request)).toBe(true);
    expect(isAnthropicWireRequest({ baseUrl: "https://api.openai.com/v1" })).toBe(false);
  });

  it("omits an empty system field and the temperature that Claude 5 models reject", () => {
    const request = anthropicWireRequest({ apiKey: "k", model: "claude-haiku-5-5", messages: [{ role: "user", content: "Hi" }] });
    expect(request).not.toHaveProperty("system");
    expect(request).not.toHaveProperty("temperature");
    expect(request).not.toHaveProperty("maxTokens");
  });

  it("turns thinking off for Haiku 5 only, because other Claude 5 models may require it", () => {
    const messages = [{ role: "user", content: "Hi" }];
    expect(anthropicWireRequest({ apiKey: "k", model: "claude-haiku-5-5", messages })).toMatchObject({ disableThinking: true });
    expect(anthropicWireRequest({ apiKey: "k", model: "claude-sonnet-5", messages })).not.toHaveProperty("disableThinking");
    expect(anthropicWireRequest({ apiKey: "k", model: "claude-fable-5-1", messages })).not.toHaveProperty("disableThinking");
    expect(anthropicWireRequest({ apiKey: "k", model: "claude-haiku-4-5", messages })).not.toHaveProperty("disableThinking");
  });
});

describe("invokeAnthropicNativeChat", () => {
  beforeEach(() => invokeMock.mockReset());

  it("calls the native Anthropic command without the wire marker and maps the answer", async () => {
    invokeMock.mockResolvedValue({ status: 200, body: messageBody(), latencyMs: 31 });
    const response = await invokeAnthropicNativeChat(anthropicWireRequest({
      apiKey: "k", model: "claude-haiku-5-5", messages: [{ role: "user", content: "Hi" }],
    }));
    expect(invokeMock).toHaveBeenCalledWith("ai_classification_anthropic_chat", {
      request: expect.not.objectContaining({ wireFormat: expect.anything() }),
    });
    expect(response.latencyMs).toBe(31);
    expect(JSON.parse(response.body as string).choices[0].message.content).toBe("{\"ok\":true}");
  });
});

describe("anthropicResponseAsOpenAiChat", () => {
  it("maps text, usage and the stop reason to the OpenAI shape", () => {
    const mapped = anthropicResponseAsOpenAiChat({ status: 200, body: messageBody(), latencyMs: 9 });
    expect(JSON.parse(mapped.body as string)).toMatchObject({
      choices: [{ index: 0, message: { role: "assistant", content: "{\"ok\":true}" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
    });
  });

  it("reports a token limit stop as finish_reason length so callers can retry or give up", () => {
    const mapped = anthropicResponseAsOpenAiChat({ status: 200, body: messageBody({ stop_reason: "max_tokens" }) });
    expect(JSON.parse(mapped.body as string).choices[0].finish_reason).toBe("length");
  });

  it("leaves errors and unparseable bodies untouched", () => {
    const rejected = { status: 401, body: JSON.stringify({ error: { type: "authentication_error" } }) };
    expect(anthropicResponseAsOpenAiChat(rejected)).toBe(rejected);
    const notJson = { status: 200, body: "<html>" };
    expect(anthropicResponseAsOpenAiChat(notJson)).toBe(notJson);
    const noContent = { status: 200, body: JSON.stringify({ id: "x" }) };
    expect(anthropicResponseAsOpenAiChat(noContent)).toBe(noContent);
  });

  it("reports missing usage as null instead of zero", () => {
    const mapped = anthropicResponseAsOpenAiChat({ status: 200, body: JSON.stringify({ content: [{ type: "text", text: "a" }] }) });
    expect(JSON.parse(mapped.body as string).usage).toEqual({ prompt_tokens: null, completion_tokens: null, total_tokens: null });
  });
});
