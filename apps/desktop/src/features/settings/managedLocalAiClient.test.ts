import { beforeEach, describe, expect, it, vi } from "vitest";

import { getManagedLocalAiStatus } from "./managedLocalAiClient";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("getManagedLocalAiStatus", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("parses actual runtime memory usage from managed local status", async () => {
    invokeMock.mockResolvedValue({
      state: "running",
      selectedModelId: "drifty-qwen3-5-4b-default",
      installedModels: [],
      baseUrl: "http://127.0.0.1:39217/v1",
      model: "drifty-qwen3.5-4b-local",
      message: "Managed local AI runtime is running.",
      artifactDir: null,
      progress: null,
      errorKind: null,
      memoryUsageBytes: 2_684_354_560,
    });

    const status = await getManagedLocalAiStatus();

    expect(status.memoryUsageBytes).toBe(2_684_354_560);
  });

  it("treats missing or invalid runtime memory usage as unavailable", async () => {
    invokeMock.mockResolvedValue({
      state: "running",
      selectedModelId: "drifty-qwen3-5-4b-default",
      installedModels: [],
      baseUrl: "http://127.0.0.1:39217/v1",
      model: "drifty-qwen3.5-4b-local",
      message: "Managed local AI runtime is running.",
      artifactDir: null,
      progress: null,
      errorKind: null,
      memoryUsageBytes: -1,
    });

    const status = await getManagedLocalAiStatus();

    expect(status.memoryUsageBytes).toBeNull();
  });
});
