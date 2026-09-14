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

  it.each([
    "download_failed",
    "model_artifact_missing",
    "insufficient_memory",
    "insufficient_storage",
    "runtime_missing",
    "runtime_download_failed",
    "runtime_port_conflict",
    "runtime_failed",
  ] as const)("preserves the structured %s recovery kind", async (errorKind) => {
    invokeMock.mockResolvedValue({
      state: "error",
      selectedModelId: "drifty-qwen3-5-4b-default",
      installedModels: [],
      baseUrl: null,
      model: null,
      message: "Managed local AI needs attention.",
      artifactDir: null,
      progress: null,
      errorKind,
      memoryUsageBytes: null,
    });

    await expect(getManagedLocalAiStatus()).resolves.toMatchObject({ errorKind });
  });

  it("preserves measured resource requirements for recovery copy", async () => {
    invokeMock.mockResolvedValue({
      state: "error",
      selectedModelId: "drifty-qwen3-5-4b-default",
      installedModels: [],
      baseUrl: null,
      model: null,
      message: "Not enough free storage.",
      artifactDir: null,
      progress: null,
      errorKind: "insufficient_storage",
      memoryUsageBytes: null,
      requiredResourceBytes: 6 * 1024 ** 3,
      availableResourceBytes: 1.8 * 1024 ** 3,
    });

    await expect(getManagedLocalAiStatus()).resolves.toMatchObject({
      requiredResourceBytes: 6 * 1024 ** 3,
      availableResourceBytes: Math.round(1.8 * 1024 ** 3),
    });
  });
});
