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

  it("does not resend an ambiguous timeout to a runtime that is still healthy", async () => {
    vi.useFakeTimers();
    try {
      invokeMock.mockImplementation(async (command: string) => {
        if (command === "managed_ai_status") return RUNNING_STATUS;
        if (command === "ai_classification_openai_chat") {
          await new Promise(resolve => setTimeout(resolve, 90_000));
          throw new Error("error sending request for url: operation timed out");
        }
        throw new Error(command);
      });
      const result = expect(invokeOpenAiChatWithManagedLocalRetry({ messages: [], timeoutMs: 90_000 }, provider)).rejects.toBeInstanceOf(ManagedLocalAiChatTimeoutError);
      await vi.advanceTimersByTimeAsync(90_000);
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
