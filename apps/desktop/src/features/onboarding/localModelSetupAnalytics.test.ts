import { describe, expect, it } from "vitest";
import type { ManagedLocalAiModel } from "../settings/managedLocalAiCatalog";
import { anyModelInstallable, modelTier, recommendedModelFit } from "./localModelSetupAnalytics";

function model(overrides: Partial<ManagedLocalAiModel>): ManagedLocalAiModel {
  return {
    id: "drifty-qwen3-5-4b-default",
    tier: "default",
    label: "Qwen 3.5 4B",
    detail: "",
    downloadSize: "~2.8 GB",
    diskRequired: "6 GB free",
    minimumMemory: "16 GB RAM",
    estimatedRuntimeMemoryBytes: null,
    recommended: false,
    fit: null,
    fitDetail: null,
    ...overrides,
  };
}

describe("anyModelInstallable", () => {
  it("reports the dead end when every model is insufficient", () => {
    expect(anyModelInstallable([
      model({ id: "a", fit: "insufficient" }),
      model({ id: "b", fit: "insufficient" }),
    ])).toBe(false);
  });

  it("counts a tight model as installable", () => {
    expect(anyModelInstallable([
      model({ id: "a", fit: "insufficient" }),
      model({ id: "b", fit: "tight" }),
    ])).toBe(true);
  });

  it("treats an unknown fit as installable because its button stays enabled", () => {
    expect(anyModelInstallable([model({ id: "a", fit: null })])).toBe(true);
    expect(anyModelInstallable([])).toBe(true);
  });
});

describe("recommendedModelFit", () => {
  it("returns the recommended model's fit", () => {
    expect(recommendedModelFit([
      model({ id: "a", fit: "good" }),
      model({ id: "b", fit: "tight", recommended: true }),
    ])).toBe("tight");
  });

  it("falls back to unknown without a recommendation", () => {
    expect(recommendedModelFit([model({ id: "a", fit: "good" })])).toBe("unknown");
  });
});

describe("modelTier", () => {
  it("resolves a tier and falls back to unknown", () => {
    const catalog = [model({ id: "a", tier: "economy" })];
    expect(modelTier(catalog, "a")).toBe("economy");
    expect(modelTier(catalog, "missing")).toBe("unknown");
    expect(modelTier(catalog, null)).toBe("unknown");
  });
});
