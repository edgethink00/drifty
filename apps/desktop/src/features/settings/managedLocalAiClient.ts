import { invoke } from "@tauri-apps/api/core";

export type ManagedLocalAiInstallState = "not_installed" | "installing" | "installed" | "starting" | "running" | "error";

export type ManagedLocalAiModel = {
  readonly id: string;
  readonly tier: "economy" | "default" | "gemma" | "smart";
  readonly label: string;
  readonly detail: string;
  readonly downloadSize: string;
  readonly diskRequired: string;
  readonly minimumMemory: string;
  readonly recommended: boolean;
};

export type ManagedLocalAiDownloadProgress = {
  readonly percent: number;
  readonly downloadedBytes: number;
  readonly totalBytes: number;
};

export type ManagedLocalAiInstalledModel = {
  readonly id: string;
  readonly artifactDir: string;
};

export type ManagedLocalAiStatusErrorKind = "download_failed" | "model_artifact_missing";

export type ManagedLocalAiStatus = {
  readonly state: ManagedLocalAiInstallState;
  readonly selectedModelId: string | null;
  readonly installedModels: readonly ManagedLocalAiInstalledModel[];
  readonly baseUrl: string | null;
  readonly model: string | null;
  readonly message: string;
  readonly artifactDir: string | null;
  readonly progress: ManagedLocalAiDownloadProgress | null;
  readonly errorKind: ManagedLocalAiStatusErrorKind | null;
};

export const MANAGED_LOCAL_AI_FALLBACK_CATALOG = [
  {
    id: "drifty-qwen3-5-2b-economy",
    tier: "economy",
    label: "Qwen 3.5 2B",
    detail: "Small managed local model for quick classification checks.",
    downloadSize: "~1.4 GB",
    diskRequired: "3 GB free",
    minimumMemory: "8 GB RAM",
    recommended: false,
  },
  {
    id: "drifty-qwen3-5-4b-default",
    tier: "default",
    label: "Qwen 3.5 4B",
    detail: "Recommended balance for on-device Drifty classification.",
    downloadSize: "~2.8 GB",
    diskRequired: "6 GB free",
    minimumMemory: "16 GB RAM",
    recommended: true,
  },
  {
    id: "drifty-gemma-4-12b-local",
    tier: "gemma",
    label: "Gemma 4 12B",
    detail: "Current Gemma 4 12B option for private local classification.",
    downloadSize: "~7.2 GB",
    diskRequired: "15 GB free",
    minimumMemory: "16 GB RAM",
    recommended: false,
  },
  {
    id: "drifty-qwen3-6-27b-smart",
    tier: "smart",
    label: "Qwen 3.6 27B",
    detail: "Smaller Qwen 3.6 option for stronger local reasoning.",
    downloadSize: "~15 GB",
    diskRequired: "30 GB free",
    minimumMemory: "36 GB RAM",
    recommended: false,
  },
] satisfies readonly ManagedLocalAiModel[];

export async function listManagedLocalAiModels(): Promise<readonly ManagedLocalAiModel[]> {
  const models = await invoke<unknown>("managed_ai_catalog");
  return Array.isArray(models) ? models.flatMap(parseManagedModel) : [];
}

export async function getManagedLocalAiStatus(): Promise<ManagedLocalAiStatus> {
  return parseManagedStatus(await invoke<unknown>("managed_ai_status"));
}

export async function installManagedLocalAiModel(modelId: string): Promise<ManagedLocalAiStatus> {
  return parseManagedStatus(await invoke<unknown>("managed_ai_install", { modelId }));
}

export async function startManagedLocalAi(modelId: string): Promise<ManagedLocalAiStatus> {
  return parseManagedStatus(await invoke<unknown>("managed_ai_start", { modelId }));
}

export async function deleteManagedLocalAiModel(modelId: string): Promise<ManagedLocalAiStatus> {
  return parseManagedStatus(await invoke<unknown>("managed_ai_delete", { modelId }));
}

export function fallbackManagedLocalAiStatus(message: string): ManagedLocalAiStatus {
  return { state: "error", selectedModelId: null, installedModels: [], baseUrl: null, model: null, message, artifactDir: null, progress: null, errorKind: null };
}

export function installingManagedLocalAiStatus(modelId: string, installedModels: readonly ManagedLocalAiInstalledModel[] = []): ManagedLocalAiStatus {
  return {
    state: "installing",
    selectedModelId: modelId,
    installedModels,
    baseUrl: null,
    model: null,
    message: "Downloading managed local model...",
    artifactDir: null,
    progress: null,
    errorKind: null,
  };
}

function parseManagedModel(value: unknown): ManagedLocalAiModel[] {
  if (!isRecord(value)) return [];
  const tier = parseTier(value.tier);
  if (!tier) return [];
  return [{
    id: stringValue(value.id),
    tier,
    label: stringValue(value.label),
    detail: stringValue(value.detail),
    downloadSize: stringValue(value.downloadSize),
    diskRequired: stringValue(value.diskRequired),
    minimumMemory: stringValue(value.minimumMemory),
    recommended: value.recommended === true,
  }];
}

function parseManagedStatus(value: unknown): ManagedLocalAiStatus {
  if (!isRecord(value)) return fallbackManagedLocalAiStatus("Managed local AI status was not readable.");
  return {
    state: parseState(value.state),
    selectedModelId: nullableString(value.selectedModelId),
    installedModels: parseInstalledModels(value.installedModels),
    baseUrl: nullableString(value.baseUrl),
    model: nullableString(value.model),
    message: stringValue(value.message) || "Managed local AI status updated.",
    artifactDir: nullableString(value.artifactDir),
    progress: parseProgress(value.progress),
    errorKind: parseErrorKind(value.errorKind),
  };
}

function parseInstalledModels(value: unknown): readonly ManagedLocalAiInstalledModel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = nullableString(item.id);
    const artifactDir = nullableString(item.artifactDir);
    return id && artifactDir ? [{ id, artifactDir }] : [];
  });
}

function parseProgress(value: unknown): ManagedLocalAiDownloadProgress | null {
  if (!isRecord(value)) return null;
  const percent = typeof value.percent === "number" && Number.isFinite(value.percent) ? value.percent : 0;
  const downloadedBytes = typeof value.downloadedBytes === "number" && Number.isFinite(value.downloadedBytes) ? value.downloadedBytes : 0;
  const totalBytes = typeof value.totalBytes === "number" && Number.isFinite(value.totalBytes) ? value.totalBytes : 0;
  if (totalBytes <= 0 && downloadedBytes <= 0) return null;
  return {
    percent: Math.min(Math.max(percent, 0), 100),
    downloadedBytes: Math.max(downloadedBytes, 0),
    totalBytes: Math.max(totalBytes, 0),
  };
}

function parseErrorKind(value: unknown): ManagedLocalAiStatusErrorKind | null {
  return value === "download_failed" || value === "model_artifact_missing" ? value : null;
}

function parseTier(value: unknown): ManagedLocalAiModel["tier"] | null {
  return value === "economy" || value === "default" || value === "gemma" || value === "smart" ? value : null;
}

function parseState(value: unknown): ManagedLocalAiInstallState {
  switch (value) {
    case "installing":
    case "installed":
    case "starting":
    case "running":
    case "error":
    case "not_installed":
      return value;
    default:
      return "error";
  }
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
