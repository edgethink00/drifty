import type { MemorySuggestionProvider } from "./useMemorySuggestions";
import { render } from "@testing-library/react";
import { useState, type Dispatch, type SetStateAction } from "react";
import { vi } from "vitest";

import { AiSetupPanel } from "./AiSetupPanel";
import type { AiConnectionStatus } from "../ai-connection/AiConnectionStatusBar";
import { DEFAULT_LOCAL_AI_SETUP, type LocalAiSetupState } from "./localAiSetup";
import { DEFAULT_ANALYSIS_AI_SETUP, type AnalysisAiSetupState } from "./analysisModelSetup";
import type { ManagedLocalAiStatus } from "./managedLocalAiClient";
import { useAiConnectionTestRunner } from "./useAiConnectionTestRunner";

const { invokeMock, resetManagedStatusMock, revealItemInDirMock, setManagedStatusMock } = vi.hoisted(() => {
  const managedCatalog = [
    { id: "drifty-qwen3-5-2b-economy", tier: "economy", label: "Qwen 3.5 2B", detail: "Small local model.", downloadSize: "~1.4 GB", diskRequired: "3 GB free", minimumMemory: "8 GB RAM", estimatedRuntimeMemoryBytes: 2_147_483_648, recommended: false },
    { id: "drifty-qwen3-5-4b-default", tier: "default", label: "Qwen 3.5 4B", detail: "Recommended local model.", downloadSize: "~2.8 GB", diskRequired: "6 GB free", minimumMemory: "16 GB RAM", estimatedRuntimeMemoryBytes: 3_758_096_384, recommended: true },
    { id: "drifty-gemma-4-12b-local", tier: "gemma", label: "Gemma 4 12B", detail: "Current Gemma 4 12B local model.", downloadSize: "~7.2 GB", diskRequired: "15 GB free", minimumMemory: "16 GB RAM", estimatedRuntimeMemoryBytes: 9_288_286_208, recommended: false },
    { id: "drifty-qwen3-6-27b-smart", tier: "smart", label: "Qwen 3.6 27B", detail: "Stronger local model.", downloadSize: "~16.8 GB", diskRequired: "30 GB free", minimumMemory: "36 GB RAM", estimatedRuntimeMemoryBytes: 19_864_223_744, recommended: false },
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
    memoryUsageBytes: null,
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
            memoryUsageBytes: null,
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
            model: runtimeModelForId(modelId),
            message: "Managed local AI runtime is running.",
            artifactDir: `/Users/test/Library/Application Support/Drifty/managed-ai/models/${modelId}`,
            progress: null,
            memoryUsageBytes: 2_684_354_560,
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
            memoryUsageBytes: null,
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

function runtimeModelForId(modelId: string): string {
  switch (modelId) {
    case "drifty-qwen3-5-2b-economy":
      return "drifty-qwen3.5-2b-local";
    case "drifty-qwen3-5-4b-default":
      return "drifty-qwen3.5-4b-local";
    case "drifty-gemma-4-12b-local":
      return "drifty-gemma4-12b-local";
    case "drifty-qwen3-6-27b-smart":
      return "drifty-qwen3.6-27b-local";
    default:
      return modelId;
  }
}

export { invokeMock, resetManagedStatusMock, revealItemInDirMock, setManagedStatusMock };

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: revealItemInDirMock,
}));

export function renderPanel({
  connectionStatus = { tone: "ok", label: "Connected", providerLabel: "Cloud AI", memoryLabel: null, issueKind: null },
  currentBillingPlan = "individual",
  billingEntitlementStatus = "active",
  initialSetup = DEFAULT_LOCAL_AI_SETUP,
  workProfileUserId = "local",
  cloudTrialAvailable = false,
  onStartCloudTrial,
  onLocalAiSetupChange,
  onAnalysisChange = vi.fn(),
  initialAnalysisSetup = DEFAULT_ANALYSIS_AI_SETUP,
  memorySuggestionProvider = null,
}: {
  readonly connectionStatus?: AiConnectionStatus;
  readonly currentBillingPlan?: "free" | "individual";
  readonly billingEntitlementStatus?: "trialing" | "active" | "locked" | null;
  readonly initialSetup?: LocalAiSetupState;
  readonly workProfileUserId?: string;
  readonly cloudTrialAvailable?: boolean;
  readonly onStartCloudTrial?: () => Promise<boolean>;
  readonly onLocalAiSetupChange?: Dispatch<SetStateAction<LocalAiSetupState>>;
  readonly onAnalysisChange?: (next: AnalysisAiSetupState) => void;
  readonly initialAnalysisSetup?: AnalysisAiSetupState;
  readonly memorySuggestionProvider?: MemorySuggestionProvider | null;
} = {}) {
  const onStartCloudSetup = vi.fn();
  const onManageCloudBilling = vi.fn();
  const onManageCloudDevices = vi.fn();
  const onLocalAiConnectionTestResult = vi.fn();
  let setConnectionStatus: Dispatch<SetStateAction<AiConnectionStatus>> | null = null;
  let observedSetup = initialSetup;

  function Harness() {
    const [localAiSetup, setLocalAiSetup] = useState<LocalAiSetupState>(initialSetup);
    observedSetup = localAiSetup;
    const [currentConnectionStatus, setCurrentConnectionStatus] = useState<AiConnectionStatus>(connectionStatus);
    const connectionTest = useAiConnectionTestRunner({
      localAiSetup,
      onLocalAiConnectionTestResult,
    });
    setConnectionStatus = setCurrentConnectionStatus;

    return (
      <AiSetupPanel
        cloudTrialAvailable={cloudTrialAvailable}
        {...(onStartCloudTrial ? { onStartCloudTrial } : {})}
        billingCheckoutLoadingInterval={null}
        billingEntitlementStatus={billingEntitlementStatus}
        billingPlansDisabled={false}
        cloudStatusRefreshing={false}
        connectionStatus={currentConnectionStatus}
        connectionTest={connectionTest}
        currentBillingPlan={currentBillingPlan}
        localAiSetup={localAiSetup}
        shouldShowCloudCheckoutPlans={false}
        workProfileUserId={workProfileUserId}
        memorySuggestionProvider={memorySuggestionProvider}
        analysisSetup={initialAnalysisSetup}
        analysisOpenRouterConnected={false}
        showIntelligenceTab
        onAnalysisChange={onAnalysisChange}
        onDialogOpenChange={vi.fn()}
        onLocalAiSetupChange={onLocalAiSetupChange ?? setLocalAiSetup}
        onManageCloudBilling={onManageCloudBilling}
        onStartCloudSetup={onStartCloudSetup}
      />
    );
  }

  const rendered = render(<Harness />);
  return {
    onLocalAiConnectionTestResult,
    onManageCloudBilling,
    onManageCloudDevices,
    onStartCloudSetup,
    unmount: rendered.unmount,
    getLocalAiSetup: () => observedSetup,
    setConnectionStatus: (nextConnectionStatus: AiConnectionStatus) => {
      if (!setConnectionStatus) throw new AiSetupPanelTestHarnessError("AI setup panel test harness is not mounted.");
      setConnectionStatus(nextConnectionStatus);
    },
  };
}

class AiSetupPanelTestHarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiSetupPanelTestHarnessError";
  }
}
