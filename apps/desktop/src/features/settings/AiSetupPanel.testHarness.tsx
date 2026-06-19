import { render } from "@testing-library/react";
import { useState } from "react";
import { vi } from "vitest";

import { AiSetupPanel } from "./AiSetupPanel";
import { DEFAULT_LOCAL_AI_SETUP, type LocalAiSetupState } from "./localAiSetup";
import type { ManagedLocalAiStatus } from "./managedLocalAiClient";

const { invokeMock, resetManagedStatusMock, revealItemInDirMock, setManagedStatusMock } = vi.hoisted(() => {
  const managedCatalog = [
    { id: "drifty-qwen3-5-2b-economy", tier: "economy", label: "Qwen 3.5 2B", detail: "Small local model.", downloadSize: "~1.4 GB", diskRequired: "3 GB free", minimumMemory: "8 GB RAM", recommended: false },
    { id: "drifty-qwen3-5-4b-default", tier: "default", label: "Qwen 3.5 4B", detail: "Recommended local model.", downloadSize: "~2.8 GB", diskRequired: "6 GB free", minimumMemory: "16 GB RAM", recommended: true },
    { id: "drifty-gemma-4-12b-local", tier: "gemma", label: "Gemma 3 12B", detail: "Mid-sized Gemma 3 local model.", downloadSize: "~8.0 GB", diskRequired: "16 GB free", minimumMemory: "24 GB RAM", recommended: false },
    { id: "drifty-qwen3-6-27b-smart", tier: "smart", label: "Qwen 3.6 27B", detail: "Stronger local model.", downloadSize: "~15 GB", diskRequired: "30 GB free", minimumMemory: "36 GB RAM", recommended: false },
  ] as const;
  const defaultManagedStatus: ManagedLocalAiStatus = {
    state: "not_installed",
    selectedModelId: null,
    installedModels: [],
    baseUrl: null,
    model: null,
    message: "Choose a local model and Drifty will download it inside the app.",
    artifactDir: null,
    progress: null,
    errorKind: null,
  };
  let managedStatus: ManagedLocalAiStatus = defaultManagedStatus;

  function modelIdFromArgs(args: unknown): string {
    if (!args || typeof args !== "object" || !("modelId" in args) || typeof args.modelId !== "string") return "";
    return args.modelId;
  }

  return {
    invokeMock: vi.fn((command: string, args?: unknown) => {
      switch (command) {
        case "managed_ai_catalog":
          return Promise.resolve(managedCatalog);
        case "managed_ai_status":
          return Promise.resolve(managedStatus);
        case "managed_ai_install": {
          const modelId = modelIdFromArgs(args);
          managedStatus = {
            ...managedStatus,
            state: "installed",
            selectedModelId: modelId,
            installedModels: upsertInstalledModel(managedStatus.installedModels, modelId),
            baseUrl: "http://127.0.0.1:39217/v1",
            model: "drifty-qwen3.5-4b-local",
            message: "Managed local model downloaded.",
            artifactDir: `/Users/test/Library/Application Support/Drifty/managed-ai/models/${modelId}`,
            progress: null,
          };
          return Promise.resolve(managedStatus);
        }
        case "managed_ai_start": {
          const modelId = modelIdFromArgs(args);
          managedStatus = {
            ...managedStatus,
            state: "running",
            selectedModelId: modelId,
            installedModels: upsertInstalledModel(managedStatus.installedModels, modelId),
            baseUrl: "http://127.0.0.1:39217/v1",
            model: "drifty-qwen3.5-4b-local",
            message: "Managed local AI runtime is running.",
            artifactDir: `/Users/test/Library/Application Support/Drifty/managed-ai/models/${modelId}`,
            progress: null,
          };
          return Promise.resolve(managedStatus);
        }
        case "managed_ai_delete": {
          const modelId = modelIdFromArgs(args);
          managedStatus = {
            ...managedStatus,
            state: "not_installed",
            selectedModelId: null,
            installedModels: managedStatus.installedModels.filter((item) => item.id !== modelId),
            baseUrl: null,
            model: null,
            artifactDir: null,
            progress: null,
            errorKind: null,
          };
          return Promise.resolve(managedStatus);
        }
        case "ai_classification_openai_chat":
          return Promise.resolve({ status: 200, body: "{\"choices\":[{\"message\":{\"content\":\"{\\\"ok\\\":true}\"}}]}", latencyMs: 42 });
        default:
          return Promise.resolve({});
      }
    }),
    resetManagedStatusMock: () => {
      managedStatus = defaultManagedStatus;
    },
    revealItemInDirMock: vi.fn().mockResolvedValue(undefined),
    setManagedStatusMock: (nextStatus: ManagedLocalAiStatus) => {
      managedStatus = nextStatus;
    },
  };
});

function upsertInstalledModel(
  installedModels: readonly ManagedLocalAiStatus["installedModels"][number][],
  modelId: string,
): ManagedLocalAiStatus["installedModels"] {
  const artifactDir = `/Users/test/Library/Application Support/Drifty/managed-ai/models/${modelId}`;
  return [
    ...installedModels.filter((item) => item.id !== modelId),
    { id: modelId, artifactDir },
  ];
}

export { invokeMock, resetManagedStatusMock, revealItemInDirMock, setManagedStatusMock };

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: revealItemInDirMock,
}));

export function renderPanel({
  currentBillingPlan = "individual",
  billingEntitlementStatus = "active",
  cloudTrialEndsAt = null,
  initialSetup = DEFAULT_LOCAL_AI_SETUP,
  userEmail = null,
  workProfileUserId = "local",
}: {
  readonly currentBillingPlan?: "free" | "individual";
  readonly billingEntitlementStatus?: "trialing" | "active" | "locked" | null;
  readonly cloudTrialEndsAt?: string | null;
  readonly initialSetup?: LocalAiSetupState;
  readonly userEmail?: string | null;
  readonly workProfileUserId?: string;
} = {}) {
  const onRefreshCloudStatus = vi.fn();
  const onStartCloudSetup = vi.fn();
  const onLocalAiConnectionTestResult = vi.fn();

  function Harness() {
    const [localAiSetup, setLocalAiSetup] = useState<LocalAiSetupState>(initialSetup);

    return (
      <AiSetupPanel
        aiServerStatusLabel="Available"
        billingCheckoutLoadingInterval={null}
        billingEntitlementError={null}
        billingEntitlementStatus={billingEntitlementStatus}
        billingPlansDisabled={false}
        cloudStatusRefreshing={false}
        cloudStatusLabel="Cloud AI available"
        cloudTrialEndsAt={cloudTrialEndsAt}
        currentBillingPlan={currentBillingPlan}
        isSupabaseConfigured={true}
        localAiSetup={localAiSetup}
        shouldShowCloudCheckoutPlans={false}
        userEmail={userEmail}
        workProfileUserId={workProfileUserId}
        onDialogOpenChange={vi.fn()}
        onLocalAiConnectionTestResult={onLocalAiConnectionTestResult}
        onLocalAiSetupChange={setLocalAiSetup}
        onRefreshCloudStatus={onRefreshCloudStatus}
        onStartCloudSetup={onStartCloudSetup}
      />
    );
  }

  render(<Harness />);
  return { onLocalAiConnectionTestResult, onRefreshCloudStatus, onStartCloudSetup };
}
