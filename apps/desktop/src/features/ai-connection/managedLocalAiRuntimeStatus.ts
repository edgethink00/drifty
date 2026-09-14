import type { ManagedLocalAiStatus } from "../settings/managedLocalAiClient";
import { MANAGED_LOCAL_AI_FALLBACK_CATALOG } from "../settings/managedLocalAiCatalog";
import type { AiConnectionStatus } from "./AiConnectionStatusBar";

export function managedLocalAiStatusForModel(
  status: ManagedLocalAiStatus | null,
  selectedModelId: string | null,
): ManagedLocalAiStatus | null {
  if (!status) return null;
  if (!status.selectedModelId) {
    if (
      status.state === "not_installed"
      && selectedModelId
      && status.installedModels.some((model) => model.id === selectedModelId.trim())
    ) {
      return null;
    }
    return status;
  }
  if (!selectedModelId?.trim()) return null;
  return status.selectedModelId === selectedModelId.trim() ? status : null;
}

export function applyManagedLocalAiRuntimeStatus(
  connectionStatus: AiConnectionStatus,
  status: ManagedLocalAiStatus | null,
): AiConnectionStatus {
  if (!status) return connectionStatus;
  const providerLabel = managedLocalAiProviderLabel(status);

  if (status.state === "starting" || status.state === "installed") {
    return {
      tone: "neutral",
      label: status.state === "starting" ? "Starting" : "Ready",
      providerLabel,
      memoryLabel: connectionStatus.memoryLabel,
      issueKind: null,
    };
  }

  if (status.state === "installing") {
    return {
      tone: "neutral",
      label: status.artifactDir ? "Preparing" : "Downloading",
      providerLabel,
      memoryLabel: null,
      issueKind: null,
    };
  }

  if (status.state === "not_installed") {
    return {
      tone: "error",
      label: "Model missing",
      providerLabel,
      memoryLabel: null,
      issueKind: "provider",
    };
  }

  const errorLabel = managedLocalAiRuntimeErrorLabel(status);
  if (!errorLabel) return connectionStatus;
  return {
    tone: "error",
    label: errorLabel,
    providerLabel,
    memoryLabel: connectionStatus.memoryLabel,
    issueKind: "provider",
  };
}

function managedLocalAiProviderLabel(status: ManagedLocalAiStatus): string {
  const selectedModelId = status.selectedModelId?.trim();
  return MANAGED_LOCAL_AI_FALLBACK_CATALOG.find((model) => model.id === selectedModelId)?.label
    ?? "Managed Local AI";
}

function managedLocalAiRuntimeErrorLabel(status: ManagedLocalAiStatus): string | null {
  if (status.state !== "error") return null;

  switch (status.errorKind) {
    case "download_failed":
      return "Download failed";
    case "model_artifact_missing":
      return "Model missing";
    case "insufficient_memory":
      return "Memory needed";
    case "insufficient_storage":
      return "Storage needed";
    case "runtime_missing":
      return "Runtime missing";
    case "runtime_download_failed":
      return "Setup download failed";
    case "runtime_port_conflict":
      return "Port in use";
    case "runtime_failed":
      return "Start failed";
    case null:
      return "Issue";
    default:
      return assertNever(status.errorKind);
  }
}

function assertNever(value: never): never {
  throw new ManagedLocalAiRuntimeStatusError(String(value));
}

class ManagedLocalAiRuntimeStatusError extends Error {
  constructor(readonly value: string) {
    super(`Unhandled managed local AI runtime status: ${value}`);
    this.name = "ManagedLocalAiRuntimeStatusError";
  }
}
