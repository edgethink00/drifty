import { describe, expect, it } from "vitest";

import { managedModelRuntimeMemoryLabel } from "./managedLocalAiMemory";
import type { ManagedLocalAiModel, ManagedLocalAiStatus } from "./managedLocalAiClient";

const model: ManagedLocalAiModel = {
  id: "drifty-qwen3-5-4b-default",
  tier: "default",
  label: "Qwen 3.5 4B",
  detail: "Recommended local model.",
  downloadSize: "~2.8 GB",
  diskRequired: "6 GB free",
  minimumMemory: "16 GB RAM",
  estimatedRuntimeMemoryBytes: 3_758_096_384,
  recommended: true,
};

function statusWith(overrides: Partial<ManagedLocalAiStatus>): ManagedLocalAiStatus {
  return {
    state: "running",
    selectedModelId: model.id,
    installedModels: [],
    baseUrl: null,
    model: null,
    message: "Running.",
    artifactDir: null,
    progress: null,
    errorKind: null,
    memoryUsageBytes: null,
    ...overrides,
  };
}

describe("managedModelRuntimeMemoryLabel", () => {
  it("formats the catalog estimate with a tilde when the model is not running", () => {
    expect(managedModelRuntimeMemoryLabel(model, null)).toBe("~3.5 GB");
  });

  it("drops the trailing .0 for whole-gigabyte estimates", () => {
    const economy = { ...model, estimatedRuntimeMemoryBytes: 2_147_483_648 };
    expect(managedModelRuntimeMemoryLabel(economy, null)).toBe("~2 GB");
  });

  it("prefers the measured usage while this model is running", () => {
    const status = statusWith({ memoryUsageBytes: 9_288_286_208 });
    expect(managedModelRuntimeMemoryLabel(model, status)).toBe("8.7 GB");
  });

  it("keeps the estimate when a different model is running", () => {
    const status = statusWith({ selectedModelId: "drifty-qwen3-5-2b-economy", memoryUsageBytes: 2_000_000_000 });
    expect(managedModelRuntimeMemoryLabel(model, status)).toBe("~3.5 GB");
  });

  it("keeps the estimate while the model is still starting", () => {
    const status = statusWith({ state: "starting", memoryUsageBytes: 1_000_000_000 });
    expect(managedModelRuntimeMemoryLabel(model, status)).toBe("~3.5 GB");
  });

  it("returns null when no estimate is available", () => {
    const bare = { ...model, estimatedRuntimeMemoryBytes: null };
    expect(managedModelRuntimeMemoryLabel(bare, null)).toBeNull();
  });
});
