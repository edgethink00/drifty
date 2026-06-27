import { invoke } from "@tauri-apps/api/core";

import { MANAGED_LOCAL_AI_FALLBACK_CATALOG, type ManagedLocalAiModel } from "./managedLocalAiCatalog";

export { MANAGED_LOCAL_AI_FALLBACK_CATALOG };
export type { ManagedLocalAiModel };

export type ManagedLocalAiInstallState = "not_installed" | "installing" | "installed" | "starting" | "running" | "error";

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
  readonly memoryUsageBytes: number | null;
};

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
  return { state: "error", selectedModelId: null, installedModels: [], baseUrl: null, model: null, message, artifactDir: null, progress: null, errorKind: null, memoryUsageBytes: null };
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
    memoryUsageBytes: null,
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
    memoryUsageBytes: parseMemoryUsageBytes(value.memoryUsageBytes),
  };
}

function parseMemoryUsageBytes(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
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
