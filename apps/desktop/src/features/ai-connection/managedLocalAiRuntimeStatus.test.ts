import { describe, expect, it } from "vitest";

import type { ManagedLocalAiStatus } from "../settings/managedLocalAiClient";
import type { AiConnectionStatus } from "./AiConnectionStatusBar";
import {
  applyManagedLocalAiRuntimeStatus,
  managedLocalAiStatusForModel,
} from "./managedLocalAiRuntimeStatus";

const connectedStatus: AiConnectionStatus = {
  tone: "ok",
  label: "Connected",
  providerLabel: "Qwen 3.5 2B",
  memoryLabel: "1.2 GB RAM",
  issueKind: null,
};

describe("managed local AI runtime status presentation", () => {
  it("keeps a current runtime failure authoritative over an old connected probe", () => {
    const status = managedStatus("error", "drifty-qwen3-5-2b-economy", "runtime_failed");

    expect(applyManagedLocalAiRuntimeStatus(connectedStatus, status)).toEqual({
      tone: "error",
      label: "Start failed",
      providerLabel: "Qwen 3.5 2B",
      memoryLabel: "1.2 GB RAM",
      issueKind: "provider",
    });
  });

  it("labels a model-less managed runtime issue without implying self-hosted local AI", () => {
    const status = managedStatus("error", null, "runtime_missing");

    expect(applyManagedLocalAiRuntimeStatus(connectedStatus, status)).toMatchObject({
      label: "Runtime missing",
      providerLabel: "Managed Local AI",
    });
  });

  it("shows starting instead of connected until the current runtime is ready", () => {
    const status = managedStatus("starting", "drifty-qwen3-5-2b-economy");

    expect(applyManagedLocalAiRuntimeStatus(connectedStatus, status)).toMatchObject({
      tone: "neutral",
      label: "Starting",
      issueKind: null,
    });
  });

  it("does not present an installed artifact as a connected process", () => {
    const status = managedStatus("installed", "drifty-qwen3-5-2b-economy");

    expect(applyManagedLocalAiRuntimeStatus(connectedStatus, status)).toMatchObject({
      tone: "neutral",
      label: "Checking",
      issueKind: null,
    });
  });

  it("does not present a missing selected artifact as connected", () => {
    const status = managedStatus("not_installed", null);

    expect(applyManagedLocalAiRuntimeStatus(connectedStatus, status)).toMatchObject({
      tone: "error",
      label: "Model missing",
      issueKind: "provider",
    });
  });

  it("ignores a stale status from a different managed model", () => {
    const status = managedStatus("error", "drifty-qwen3-5-4b-default", "runtime_failed");

    expect(managedLocalAiStatusForModel(status, "drifty-qwen3-5-2b-economy")).toBeNull();
  });

  it("preserves global managed-runtime errors without a model id", () => {
    const status = managedStatus("error", null, null);

    expect(managedLocalAiStatusForModel(status, "drifty-qwen3-5-2b-economy")).toBe(status);
  });

  it("ignores a model-less delete status when the selected model remains installed", () => {
    const status = {
      ...managedStatus("not_installed", null),
      installedModels: [{ id: "drifty-qwen3-5-2b-economy", artifactDir: "/tmp/qwen-2b" }],
    };

    expect(managedLocalAiStatusForModel(status, "drifty-qwen3-5-2b-economy")).toBeNull();
  });
});

function managedStatus(
  state: ManagedLocalAiStatus["state"],
  selectedModelId: string | null,
  errorKind: ManagedLocalAiStatus["errorKind"] = null,
): ManagedLocalAiStatus {
  return {
    state,
    selectedModelId,
    installedModels: [],
    baseUrl: "http://127.0.0.1:39217/v1",
    model: "drifty-qwen3.5-2b-local",
    message: state,
    artifactDir: "/tmp/model",
    progress: null,
    errorKind,
    memoryUsageBytes: null,
    requiredResourceBytes: null,
    availableResourceBytes: null,
  };
}
