import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import {
  listOpenAiCompatibleModels,
  MAX_DISCOVERED_MODEL_ID_LENGTH,
  MAX_DISCOVERED_MODELS,
} from "./openAiCompatibleModels";

describe("listOpenAiCompatibleModels", () => {
  beforeEach(() => invokeMock.mockReset());

  it("fetches, trims, deduplicates, and sorts OpenAI-compatible model ids", async () => {
    invokeMock.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ data: [{ id: "z-model" }, { id: " a-model " }, { id: "z-model" }, { nope: true }] }),
    });

    await expect(listOpenAiCompatibleModels(" http://localhost:11434/v1/ ", " secret ")).resolves.toEqual({
      models: ["a-model", "z-model"],
      totalCount: 2,
    });
    expect(invokeMock).toHaveBeenCalledWith("ai_list_openai_models", {
      request: { baseUrl: "http://localhost:11434/v1", apiKey: "secret" },
    });
  });

  it("rejects malformed and non-HTTP endpoint URLs before invoking native code", async () => {
    await expect(listOpenAiCompatibleModels("not a URL", "")).rejects.toMatchObject({ code: "invalid-base-url" });
    await expect(listOpenAiCompatibleModels("file:///tmp/models", "")).rejects.toMatchObject({ code: "unsupported-protocol" });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("caps the rendered model list while reporting the full unique count", async () => {
    const ids = Array.from({ length: MAX_DISCOVERED_MODELS + 5 }, (_, index) => ({ id: `model-${index}` }));
    invokeMock.mockResolvedValue({ status: 200, body: JSON.stringify({ data: ids }) });

    const result = await listOpenAiCompatibleModels("https://models.example/v1", "");

    expect(result.models).toHaveLength(MAX_DISCOVERED_MODELS);
    expect(result.totalCount).toBe(MAX_DISCOVERED_MODELS + 5);
  });

  it("drops pathological model IDs before they reach the combobox DOM", async () => {
    invokeMock.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ data: [{ id: "usable-model" }, { id: "x".repeat(MAX_DISCOVERED_MODEL_ID_LENGTH + 1) }] }),
    });

    await expect(listOpenAiCompatibleModels("https://models.example/v1", "")).resolves.toEqual({
      models: ["usable-model"],
      totalCount: 1,
    });
  });

  it("keeps manual entry available when the endpoint response is incompatible", async () => {
    invokeMock.mockResolvedValue({ status: 200, body: JSON.stringify({ models: [] }) });

    await expect(listOpenAiCompatibleModels("http://localhost:11434/v1", "")).rejects.toThrow(
      "did not return an OpenAI-compatible model list",
    );
  });
});
