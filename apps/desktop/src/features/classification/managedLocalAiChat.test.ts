import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensureManagedLocalAiReady,
  invokeOpenAiChatWithManagedLocalRetry,
  MANAGED_LOCAL_AI_READY_TIMEOUT_MS,
  ManagedLocalAiChatTimeoutError,
} from "./managedLocalAiChat";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const MODEL_ID = "drifty-qwen3-6-27b-smart";
const STARTING_STATUS = {
  state: "starting",
  selectedModelId: MODEL_ID,
  installedModels: [{ id: MODEL_ID, artifactDir: "/managed-ai/models/qwen-27b" }],
  baseUrl: "http://127.0.0.1:39217/v1",
  model: "drifty-qwen3.6-27b-local",
  message: "Managed local AI runtime is starting.",
  artifactDir: "/managed-ai/models/qwen-27b",
  progress: null,
  errorKind: null,
  memoryUsageBytes: null,
};
const RUNNING_STATUS = {
  ...STARTING_STATUS,
  state: "running",
  message: "Managed local AI runtime is running.",
  memoryUsageBytes: 19_000_000_000,
};

describe("managed local AI cold-start wait", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps waiting after the legacy eight-second window for a larger model", async () => {
    let statusPolls = 0;
    invokeMock.mockImplementation((command: string) => {
      if (command === "managed_ai_start") return Promise.resolve(STARTING_STATUS);
      if (command === "managed_ai_status") {
        statusPolls += 1;
        return Promise.resolve(statusPolls <= 16 ? STARTING_STATUS : RUNNING_STATUS);
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    const ready = ensureManagedLocalAiReady(MODEL_ID);
    await vi.advanceTimersByTimeAsync(8_500);

    await expect(ready).resolves.toMatchObject({ state: "running", selectedModelId: MODEL_ID });
    expect(statusPolls).toBe(17);
    expect(MANAGED_LOCAL_AI_READY_TIMEOUT_MS).toBe(120_000);
  });

  it("still fails at the native two-minute cold-start deadline", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "managed_ai_start" || command === "managed_ai_status") return Promise.resolve(STARTING_STATUS);
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    const ready = expect(ensureManagedLocalAiReady(MODEL_ID)).rejects.toThrow(
      "Managed local AI runtime did not become ready",
    );
    await vi.advanceTimersByTimeAsync(MANAGED_LOCAL_AI_READY_TIMEOUT_MS);

    await ready;
  });
});


describe("managed local send guard", () => {
  const provider = { provider: "managed_local" as const, modelId: MODEL_ID, baseUrl: RUNNING_STATUS.baseUrl, model: RUNNING_STATUS.model };
  beforeEach(() => { invokeMock.mockReset(); });

  it("does not send if consent changes during runtime discovery", async () => {
    let allowed = true;
    let finish!: (value: unknown) => void;
    invokeMock.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const response = invokeOpenAiChatWithManagedLocalRetry({ messages: [] }, provider, () => allowed);
    const rejected = expect(response).rejects.toThrow("cancelled");
    allowed = false;
    finish(RUNNING_STATUS);
    await rejected;
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual(["managed_ai_status"]);
  });

  it.each([
    ["healthy", RUNNING_STATUS],
    ["unresponsive", { ...RUNNING_STATUS, state: "error", errorKind: "runtime_failed" }],
  ])("does not restart or resend an ambiguous timeout when the runtime is %s", async (_name, failedStatus) => {
    vi.useFakeTimers();
    try {
      let statusReads = 0;
      let chatCalls = 0;
      invokeMock.mockImplementation(async (command: string) => {
        if (command === "managed_ai_status") return ++statusReads === 1 ? RUNNING_STATUS : failedStatus;
        if (command === "managed_ai_start") return RUNNING_STATUS;
        if (command === "ai_classification_openai_chat") {
          if (++chatCalls > 1) return { status: 200, body: "ambiguous request resent" };
          await new Promise(resolve => setTimeout(resolve, 180_000));
          throw new Error("error sending request for url: operation timed out");
        }
        throw new Error(command);
      });
      const result = expect(invokeOpenAiChatWithManagedLocalRetry({ messages: [], timeoutMs: 180_000 }, provider)).rejects.toBeInstanceOf(ManagedLocalAiChatTimeoutError);
      await vi.advanceTimersByTimeAsync(180_000);
      await result;
      expect(invokeMock.mock.calls.filter(([command]) => command === "ai_classification_openai_chat")).toHaveLength(1);
      expect(invokeMock.mock.calls.filter(([command]) => command === "managed_ai_start")).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });

  it("does not resend after a connection recovery if consent was withdrawn", async () => {
    let allowed = true;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "managed_ai_status") return invokeMock.mock.calls.filter(([name]) => name === "managed_ai_status").length === 1
        ? RUNNING_STATUS : { ...RUNNING_STATUS, state: "installed" };
      if (command === "ai_classification_openai_chat") throw new Error("connection refused");
      if (command === "managed_ai_start") { allowed = false; return RUNNING_STATUS; }
      throw new Error(command);
    });
    await expect(invokeOpenAiChatWithManagedLocalRetry({ messages: [] }, provider, () => allowed)).rejects.toThrow("cancelled");
    expect(invokeMock.mock.calls.filter(([command]) => command === "ai_classification_openai_chat")).toHaveLength(1);
  });
});
describe("self-hosted thinking-off fallback", () => {
  const request = { baseUrl: "http://localhost:8080/v1", model: "test", messages: [], chatTemplateKwargs: { enable_thinking: false } };

  it("resends once without the chat template field when the server names it in a refusal", async () => {
    const invokeChat = vi.fn()
      .mockResolvedValueOnce({ status: 400, body: JSON.stringify({ error: { message: "Unrecognized request argument supplied: chat_template_kwargs" } }) })
      .mockResolvedValueOnce({ status: 200, body: "{}" });

    await expect(invokeOpenAiChatWithManagedLocalRetry(request, null, () => true, { invokeChat })).resolves.toMatchObject({ status: 200 });
    expect(invokeChat).toHaveBeenCalledTimes(2);
    expect(invokeChat.mock.calls[1]?.[0]).not.toHaveProperty("chatTemplateKwargs");
    expect(invokeChat.mock.calls[1]?.[0]).toMatchObject({ baseUrl: request.baseUrl, model: request.model });
  });

  it("keeps any other refusal as the answer", async () => {
    const invokeChat = vi.fn().mockResolvedValue({ status: 400, body: JSON.stringify({ error: { message: "This model's maximum context length is 4096 tokens." } }) });

    await expect(invokeOpenAiChatWithManagedLocalRetry(request, null, () => true, { invokeChat })).resolves.toMatchObject({ status: 400 });
    expect(invokeChat).toHaveBeenCalledTimes(1);
  });
});
